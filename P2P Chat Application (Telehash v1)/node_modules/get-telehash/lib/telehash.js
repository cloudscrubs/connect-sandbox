(function () {
	"use strict";
	var udp = require('./udp');
	var slib = require('./switch');
	var hlib = require('./hash');
	var util = require('./iputil');

	// high level exported functions
	// init({port:42424, seeds:['1.2.3.4:5678'], mode:(1|2|3) })
	// use it to pass in custom settings other than defaults
	exports.init = getSelf;

	// seed(function(err){}) - will start seeding to DHT, calls back w/ status and info on state change
	exports.seed = doSeed;


	// listen('id', function(){}) - give an id to listen to on the DHT, callback fires whenever incoming messages (requests) arrive to it.
	// essentially this gives us a way to announce ourselves on the DHT by a sha1 hash of given id.
	// think of the id like a dns hostname,url,email address,mobile number...etc.
	exports.listen = doListen;

	// connect('id') - id to connect to. Will return a 'connector' object used to send messages (requests), and handle responses
	exports.connect = doConnect;

	// send('ip:port', {...}) - sends the given telex to the target ip:port
	// will attempt to find it and punch through any NATs, etc, but is lossy, no guarantees/confirmations
	// it's best to use this function rather than Switch.prototype.send().
	exports.send = doSend;

	//join and discover switches on the LAN
	exports.broadcast = doBroadcast;

	exports.tap = doTap;
	exports.dial = doDial;
	exports.announce = doAnnounce;
	exports.ping = doPing;

	// go offline and closes the network socket if we created, otherwise stops listening to incoming messages from it
	exports.shutdown = doShutdown;

	//go offline
	exports.offline = function (reason) {
		goOffline(reason || "application-request");
	};

	//return current state
	exports.state = function () {
		return self ? self.state : STATE.OFFLINE;
	};

	//return operating mode
	exports.mode = function () {
		return self ? self.mode : MODE.LISTENER;
	};

	//return true if we are being a NAT
	exports.nat = function () {
		return self ? self.nat : false;
	};

	//return an array of ipp of switches in the network excluding us
	exports.peers = function () {
		var peers = [];
		slib.getSwitches().forEach(function (s) {
			if (s.self) return;
			peers.push(s.ipp);
		});
		return peers;
	};

	//address of the switch in the DHT
	exports.address = function () {
		if (!self || !self.me) return undefined;
		return ({
			address: self.me.ip,
			port: self.me.port,
			hash: self.me.end,
			ipp: self.me.ipp
		});
	};

	//return underlying dgram socket address
	exports.socketAddress = function () {
		if (!self || !self.socket) return undefined;
		return self.socket.address();
	};

	exports.socket = function () {
		return self.socket;
	};

	//how long we have been online in seconds
	exports.uptime = function () {
		if (!self || !self.me) return 0;
		return (Date.now() - self.me.ATinit) / 1000;
	};

	// internals
	var self;
	var listeners = []; //maintain an array of .tap rules we are interested in
	var connectors = {}; //maintains a hashtable of ends we are interested in contacting indexed by a end name.
	var responseHandlers = {}; //maintains a hashtable of response handlers indexed by connection 'guid'
	var popListener;

	var STATE = exports.STATE = require("./states.js").STATES;
	var MODE = exports.MODE = require("./modes.js").MODES;
	var TIMERS = exports.TIMERS = require("./timers.js").TIMERS;


	// init self, use this whenever it may not be init'd yet to be safe
	function getSelf(arg, onInitialised) {
		onInitialised = onInitialised || function () {};

		if (typeof arg === 'function') {
			onInitialised = arg;
		}

		//already initialised
		if (self) {
			onInitialised(new Error("already-initialised"));
			return;
		}
		if (typeof arg === 'function') {
			self = {};
		} else {
			self = arg;
		}

		//use provided dgram socket instead of creating new one
		//socket must already be bound
		if (self.socket) {
			self.socket.on("message", incomingDgram);
			if (self.socket._bindState === 0) {
				//socket is closed
				self = undefined;
				onInitialised(new Error("socket closed"));
				return;
			}
			if (self.socket._bindState > 0 && self.socket._receiving) {
				self.socket.setBroadcast(true);
				initialiseSelf(self.socket);
				return;
			}
			self.socket.on("listening", function () {
				self.socket.setBroadcast(true);
				initialiseSelf(self.socket);
			});
			return;
		} else {
			// udp socket - If bind port is not specified, pick a random open port.
			udp.createSocket(incomingDgram, self.port ? parseInt(self.port) : 0, self.interface,
				function (err, socket) {
					if (err) {
						self = undefined;
						onInitialised(err);
						return;
					} else {
						initialiseSelf(socket);
					}
				}, self.respondToBroadcasts);
		}

		function initialiseSelf(socket) {
			self.socket = socket;
			if (!self.mode) self.mode = MODE.LISTENER; //default operating mode
			self.state = STATE.OFFLINE; //start in offline state
			if (!self.seeds) self.seeds = ['178.79.135.146:42424', '178.79.135.146:42425'];
			// set up switch master callbacks
			var callbacks = {
				socket_send: socket.send.bind(socket),
				nat: function () {
					return (self.nat === true);
				},
				news: processNewSwitch,
				data: processSignals,
				signals: processSignals,
				mode: function () {
					return self.mode;
				},
				packetLog: self.packetLog,
				state: function () {
					return self.state;
				}
			};

			slib.setCallbacks(callbacks);

			if (typeof socket.on === 'function') {
				socket.on("close", function () {
					doShutdown("socket-closed");
				});
				socket.on("error", function () {
					doShutdown("socket-error");
				});
			}

			onInitialised();
		}
	}

	function startScanner() {
		// start timer to monitor all switches and drop any over thresholds and not in buckets
		if (!self.scanInterval) self.scanInterval = setInterval(scan, TIMERS.SCAN_INTERVAL); // every 25sec, so that it runs 2x in <60 (if behind a NAT to keep mappings alive)
		// start timer to send out .taps and dial switches closer to the ends we want to .tap
		if (!self.connect_listen_Interval) self.connect_listen_Interval = setInterval(connect_listen, TIMERS.CONNECT_LISTEN_INTERVAL);
		if (self.broadcastMode) {
			if (!self.broadcastInterval) self.broadcastInterval = setInterval(sendBroadcastTelex, TIMERS.BROADCAST_INTERVAL); //broadcast every 10 seconds looking for new telehash switches on the LAN
		}
	}

	function stopScanner() {
		if (self.scanInterval) clearInterval(self.scanInterval);
		delete self.scanInterval;
		if (self.connect_listen_Interval) clearInterval(self.connect_listen_Interval);
		delete self.connect_listen_Interval;
		if (self.broadcastInterval) clearInterval(self.broadcastInterval);
		delete self.broadcastInterval;
		if (self.seedTimeout) clearTimeout(self.seedTimeout);
		delete self.seedTimeout;
	}

	function goOnline() {
		var listener, off;
		//update connector listeners with new end name
		for (var conn in connectors) {
			listener = connectors[conn].listener;
			if (!listener) continue;
			off = listener.off;
			connectors[conn].listener = connectResponseListener(listener._connect);
			connectors[conn].listener.off = off;
		}
		if (self.onStatusChange) self.onStatusChange("online", self.me.ipp);
		startScanner();
	}

	function goOffline(reason) {
		self.state = STATE.OFFLINE;
		stopScanner();
		// drop all switches
		slib.getSwitches().forEach(function (s) {
			s.drop();
		});
		if (self) {
			delete self.me;
			delete self.nat;
			delete self.snat;
		}
		popListener = undefined;
		timeoutResponseHandlers(true);
		if (reason && self.onStatusChange) self.onStatusChange("offline", reason);
	}

	function doBroadcast() {
		if (!self) return;
		if (self.state === STATE.ONLINE) return;
		self.state = STATE.ONLINE;
		self.broadcastMode = true;
		self.me = slib.getSwitch(self.socket.address().address + ":" + self.socket.address().port);
		self.me.self = true;
		self.me.visible = true;

		startScanner();
		sendBroadcastTelex();
	}

	function sendBroadcastTelex() {
		if (!self) return;
		var msg = new Buffer(JSON.stringify({
			_to: '255.255.255.255:42424'
		}) + '\n', "utf8");
		try {
			self.socket.send(msg, 0, msg.length, 42424, '255.255.255.255', function (err, bytes) {
				if (err) {
					if (self.log) self.log("broadcast failed.");
				}
			});
		} catch (e) {}
	}

	function doSeed(callback) {
		getSelf();
		if (!self) {
			callback("not-initialised");
			return;
		}
		if (self._shutting_down) return;

		if (!self.seeds || !self.seeds.length) {
			throw ("no seeds defined");
		}
		if (self.seeds[0].indexOf('255.255.255.255:') === 0) {
			throw ("use broadcast mode");
		}

		goOffline();

		self.state = STATE.SEEDING;

		if (callback) {
			self.onStatusChange = callback;
		}
		if (!self.socket) {
			doShutdown("socket-error");
			return;
		}
		try {
			self.socket.address();
		} catch (e) {
			doShutdown("socket-closed");
			return;
		}

		if (self.onStatusChange) self.onStatusChange("connecting");
		// in 10 seconds, error out if nothing yet!
		self.seedTimeout = setTimeout(function () {
			self.state = STATE.OFFLINE; //go back into offline state
			delete self.seedTimeout;
			//try again...
			doSeed(callback);
		}, TIMERS.SEED_TIMEOUT);

		pingSeeds();
	}

	function pingSeeds() {
		if (!self) return;
		// loop all seeds, asking for furthest end from them to get the most diverse responses!
		self.seeds.forEach(function (ipp) {
			var hash = new hlib.Hash(ipp);
			var s = slib.getSwitch(ipp);
			s.seed = true; //mark it as a seed - (during scan check if we have lines open to any initial seeds)
			s.visible = true;
			s.popped = true;
			s.send({
				'+end': hash.far()
			});
		});
	}

	//filter incoming packets based on STATE
	function incomingDgram(msg, rinfo) {
		if (!self) return;
		var telex;
		if (self.state === STATE.OFFLINE) {
			//drop all packets
			return;
		}
		//who is it from?
		var from = rinfo.address + ":" + rinfo.port;

		//parse the packet..
		try {
			telex = JSON.parse(msg.toString());
			if (self.packetLog) self.packetLog("<< %s (%s)", from, msg.length, telex);
		} catch (E) {
			return;
		}

		//at this point we should have a telex for processing

		if (self.state === STATE.SEEDING) {
			//only accept packets from seeds - note: we need at least 2 live seeds for SNAT detection
			for (var i in self.seeds) {
				if (from === self.seeds[i]) {
					handleSeedTelex(telex, from, msg.length);
					break;
				}
			}
			return;
		}

		if (self.state === STATE.ONLINE) {
			//process all packets
			handleTelex(telex, from, msg.length);
		}
	}

	function handleSeedTelex(telex, from, len) {
		if (telex._to && telex._to.indexOf("255.255.255.255:") === 0) return;

		//do NAT detection once
		if (!self.nat) {
			if (!self.me && telex._to && !util.isLocalIP(telex._to)) {
				//we are behind NAT
				self.nat = true;
				//console.error("NAT detected.");
			}
		}

		//first telex from seed will establish our identity
		if (!self.me && telex._to) {
			self.me = slib.getSwitch(telex._to);
			self.me.self = true; // flag switch to not send to itself
			if (self.seedTimeout) clearTimeout(self.seedTimeout);
			delete self.seedTimeout;
			if (self.log) self.log("our ipp:", self.me.ipp, self.me.end);
			//delay...to allow time for SNAT detection (we need a response from another seed)
			setTimeout(function () {
				if (!self) return;

				if (self.snat) {
					//telehash is useless behind SNAT
					goOffline("snat-detected");
					return;
				}

				if (self.mode === MODE.FULL) {
					self.me.visible = true; //become visible (announce our-selves in .see commands)
				}

				self.state = STATE.ONLINE;

				if (self.nat && self.mode !== MODE.ANNOUNCER) doPopTap(); //only needed if we are behind NAT
				goOnline();
			}, TIMERS.SNAT_TIMEOUT);
		}

		if (self.me && from === self.me.ipp) {
			if (self.log) self.log("self seeding.");
			self.seed = true;
		}

		if (telex._to && self.me && !self.snat && (util.IP(telex._to) === self.me.ip) && (self.me.ipp !== telex
				._to)) {
			//we are behind symmetric NAT
			self.snat = true;
			self.nat = true;
			return;
		}

		//mark seed as visible
		slib.getSwitch(from).visible = true;
		handleTelex(telex, from, len); //handle the .see from the seed - establish line
	}

	function handleTelex(telex, from, len) {
		if (!self) return;
		if (self.me && from === self.me.ipp) return; //dont process packets that claim to be from us! (we could be our own seed)

		if (!telex._to) return;

		//if we are participating in a LAN broadcast DHT..ping the switch.
		if (telex._to.indexOf('255.255.255.255:') === 0 && (self.broadcastMode || self.respondToBroadcasts)) {
			//if(!slib.knownSwitch(from)) doPing(from);
			doPing(from);
			return;
		}

		//_to must equal our ipp
		if (telex._to && (self.me.ipp !== telex._to)) return;

		if (util.isPrivateIP(self.me.ipp) !== util.isPrivateIP(from)) {
			return;
		}

		//if there is a _line in the telex we should already know them..
		if (telex._line) {
			if (!slib.knownSwitch(from)) return;
		}

		var sw = slib.getSwitch(from);
		if (self.broadcastMode) sw.visible = true;
		sw.process(telex, len);
	}

	// process a validated telex that has signals,data and commands to be handled
	// these would be signals we have .tap'ed for
	function processSignals(from, telex) {
		if (self.mode === MODE.ANNOUNCER) return;

		//ignore .tap and .see (already handeled by switch)
		if (telex['.tap'] || telex['.see'] || telex['+pop']) return;

		if (handleConnectResponses(from, telex)) return; //intercept +response signals
		if (handleConnects(from, telex)) return; //intercept +connect signals

		//look for listener .tapping signals in this telex and callback it's handler
		listeners.forEach(function (listener) {
			if (listener.off) return;
			if (slib.ruleMatch(telex, listener.rule) && listener.cb) listener.cb(from, telex);
		});
	}

	function timeoutResponseHandlers(forcetimeout) {
		for (var guid in responseHandlers) {
			if (Date.now() > responseHandlers[guid].timeout || forcetimeout) {
				if (responseHandlers[guid].callback) responseHandlers[guid].callback(undefined); //always callback after timeout..
				delete responseHandlers[guid];
			}
		}
	}

	function handleConnects(from, telex) {
		//return an object containing the message and a function to send reply
		//the reply function will send via relay if direct is not possible
		//indicate in object which type of reply will occur!
		if (!telex['+connect']) return false;

		listeners.forEach(function (listener) {
			if (listener.off) return;
			if (slib.ruleMatch(telex, listener.rule) && listener.cb) {
				listener.cb({
					guid: telex['+connect'],
					message: telex['+message'],
					from: telex['+from'],
					source: from.ipp,
					// always return via relay signals..
					reply: function (message) {
						if (!telex['+from']) return; //if they didn't send us their end we can't reply
						from.send({
							'+end': telex['+from'],
							'+message': message,
							'+response': telex['+connect'],
							'_hop': 1
						});
					}
				});
			}
		});
		return true;
	}

	function handleConnectResponses(from, telex) {
		if (telex['+response']) {
			//this would be a telex +reponse to our outgoing +connect (could be direct or relayed)
			for (var guid in responseHandlers) {
				if (guid === telex['+response'] && responseHandlers[guid].callback) {
					responseHandlers[guid].responses++;
					responseHandlers[guid].callback({
						from: from.ipp,
						message: telex['+message'],
						count: responseHandlers[guid].responses
					});
					return true;
				}
			}
			return true;
		}
		return false;
	}

	function sendPOPRequest(ipp) {
		if (!self) return;
		slib.getSwitch(ipp).popped = true;
		doAnnounce(ipp, {
			'+pop': 'th:' + self.me.ipp
		});
	}

	function processNewSwitch(s) {
		//new .seen switch
		if (self && self.me) {
			//console.error("Pinging New switch: ",s.ipp);
			if (s.via) {
				s.popped = true;
				doSend(s.via, {
					'+end': s.end,
					'+pop': 'th:' + self.me.ipp,
					'_hop': 1
				});
			}

			if (self.mode !== MODE.ANNOUNCER) doPing(s.ipp); //will pop if required..
		}

		// TODO if we're actively listening, and this is closest yet, ask it immediately
	}

	function doPopTap() {
		if (!self) return;
		if (self.mode === MODE.ANNOUNCER) return;

		if (self.nat) {
			popListener = {
				hash: self.me.hash,
				end: self.me.end,
				rule: {
					'is': {
						'+end': self.me.end
					},
					'has': ['+pop']
				}
			};
		}
	}

	function connectResponseListener(connect_endname) {
		if (self.mode === MODE.ANNOUNCER) return;
		var hash = new hlib.Hash(connect_endname); //where we will .tap
		var end; //end we are tapping for - where responses will be sent
		//if we are offline, it will be set in goOnline() when we go online.
		if (self && self.me) end = new hlib.Hash(self.me.ipp).toString();

		var rule = {
			'is': {
				'+end': end
			},
			'has': ['+response']
		};
		var listener = {
			end: end,
			hash: hash,
			rule: rule,
			_connect: connect_endname //keep reference for when we need to update this listener
		};
		return listener;
	}

	// setup a listener for the hash of arg.id
	// we want to receive telexe which have a +connect signal in them.
	function doListen(id, callback) {
		//add a listener for arg.id
		var hash = new hlib.Hash(id);
		var rule = {
			'is': {
				'+end': hash.toString()
			},
			'has': ['+connect']
		};

		return doTap(id, rule, callback);
	}

	function listenLoop() {
		if (!self) return;
		if (self.mode === MODE.ANNOUNCER) return;
		if (self.state !== STATE.ONLINE) return;

		var active_listeners = [];

		listeners.forEach(function (listener) {
			if (!listener) return;
			if (listener.off) return;
			active_listeners.push(listener);
		});

		if (popListener) active_listeners.push(popListener);

		for (var conn in connectors) {
			if (connectors[conn].listener && connectors[conn].listener.off === false) {
				active_listeners.push(connectors[conn].listener);
			}
		}

		//look for closer switches
		active_listeners.forEach(function (listener) {
			if (!listener) return;
			if (listener.off) return;
			slib.getNear(listener.hash).forEach(function (ipp) {
				doSend(ipp, {
					'+end': listener.hash.toString()
				});
			});
		});

		sendTapRequests(active_listeners);
	}

	//TODO: from telehash.org/proto.html, under section common patterns:.. then send a .tap of
	//which Signals to observe to those Switches close to the End along with some test Signals,
	//who if willing will respond with process the .tap and immediately send the matching Signals
	//back to confirm that it's active.
	function sendTapRequests(listeners, noRateLimit) {
		//TODO make sure to only .tap visible switches..
		var limit = noRateLimit ? false : true;
		var tapRequests = {}; //hash of .tap arrays indexed by switch.ipp
		//loop through all listeners and aggregate the .tap rules for each switch
		listeners.forEach(function (listener) {
			if (!listener) return;
			if (listener.off) return;
			var switches = slib.getNear(listener.hash);
			switches.forEach(function (s) {
				if (!tapRequests[s]) tapRequests[s] = [];
				tapRequests[s].push(listener.rule);
			});
		});

		Object.keys(tapRequests).forEach(function (ipp) {
			var s = slib.getSwitch(ipp);
			if (!s.line) return; //only send out the .tap request if we have a line open
			//don't send .tap too often.. need to allow time to get closer to the end we are interested in
			if (limit && s.lastTapRequest && (s.lastTapRequest + TIMERS.TAP_MIN_INTERVAL > Date.now()))
				return;
			doSend(ipp, {
				'.tap': tapRequests[ipp]
			});
			if (limit) s.lastTapRequest = Date.now();
		});
	}

	//setup a connector to indicate what ends we want to communicate with
	//only one connector per end is created. The connectors role is to constantly dial the end only
	//returns the connector object used to actually send signals to the end.
	function doConnect(end_name) {
		var conn = connectors[end_name];
		if (conn) {
			conn._handles = conn._handles + 1;
			if (conn.listener) conn.listener.off = false;
		} else {
			conn = makeConnector(end_name);
			connectors[end_name] = conn;
		}
		connectLoop(); //kick start connector
		return conn;
	}

	function makeConnector(end_name) {
		var connector = {
			id: end_name,
			send: function (message, callback, timeOut) {
				var guid = nextGUID(); //new guid for message -- RANDOM NUMBER
				//dont setup a response handler if we are not interested in a response!
				if (self && callback && self.mode !== MODE.ANNOUNCER) {
					responseHandlers[guid] = {
						callback: callback, //add a handler for the responses
						//responses must arrive within timeOut seconds, or default 10 seconds
						timeout: timeOut ? Date.now() + (timeOut * 1000) : Date.now() + TIMERS.RESPONSE_TIMEOUT,
						responses: 0 //tracks number of responses to the outgoing telex.
					};
				}
				//send the message
				if (self && self.me) {
					doAnnounce(end_name, {
						'+connect': guid,
						'+from': callback ? self.me.end : undefined,
						'+message': message
					});
				}
			},
			stop: function () {
				if (connector._handles > 1) {
					connector._handles = connector._handles - 1;
				} else {
					if (connector.listener) connector.listener.off = true;
				}
			},
			_handles: 1
		};


		connector.listener = connectResponseListener(end_name);
		connector.listener.off = false;

		return connector;
	}

	function connectLoop() {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;

		timeoutResponseHandlers();

		// dial the end continuously, timer to re-dial closest, wait forever for response and call back
		for (var end in connectors) {
			if (connectors[end]._handles === 0) continue; //don't send +connects if connector is stopped
			doDial(end);
		}
	}

	//some lower level functions
	function doTap(end, rule, callback) {
		var hash = new hlib.Hash(end);
		var listener = {
			id: end,
			hash: hash,
			end: hash.toString(),
			rule: rule,
			cb: callback
		};
		listeners.push(listener);
		return listener;
	}


	function doAnnounce(end, signals) {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;
		signals['_hop'] = 1;
		var hash = new hlib.Hash(end);
		signals['+end'] = hash.toString();
		var switches = slib.getNear(hash);
		switches.forEach(function (ipp) {
			doSend(ipp, signals);
		});
	}

	function doDial(end) {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;
		var hash = new hlib.Hash(end);
		var switches = slib.getNear(hash);
		switches.forEach(function (ipp) {
			doSend(ipp, {
				'+end': hash.toString(),
				'_hop': 0
			});
		});
		return hash.toString();
	}

	function doPing(to) {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;
		if (self.mode === MODE.ANNOUNCER) return;
		doSend(to, {
			'+end': self.me.end,
			'_hop': 0,
			'.see': self.me.visible ? [self.me.ipp] : []
		});
	}

	function doSend(to, telex) {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;

		var s = slib.getSwitch(to);

		//eliminate duplicate +end dial signals going to same switch in short-span of time.
		if (telex['+end'] && (!telex['_hop'] || telex['_hop'] === 0)) {
			var end = telex['+end'];
			if (!s.pings) s.pings = {}; //track last ping time, indexed by +end hash
			if (s.pings[end] && ((s.pings[end] + TIMERS.DIAL_MIN_INTERVAL) > Date.now())) return;
			s.pings[end] = Date.now();
		}

		if (s.popped) {
			s.send(telex);
		} else {
			//we need to +pop it, first time connecting..
			sendPOPRequest(to);
			//give the +pop signal a head start before we send out the telex
			setTimeout(function () {
				s.send(telex);
			}, TIMERS.POP_HEADSTART); //too long?
		}
	}

	function doShutdown(reason) {
		if (!self) return;
		if (self._shutting_down) return;
		self._shutting_down = true;
		goOffline(reason || "shutting-down");
		slib.clearCallbacks();

		//allow time line drops to be sent for smooth disconnection from DHT
		setTimeout(function () {
			try {
				//close socket only if we created it
				if (self.socket && self.socket._telehash) {
					self.socket.close();
				} else {
					//otherwise stop listening to incoming messages on it
					self.socket.removeListener("message", incomingDgram);
				}
			} catch (e) {}

			var notify = self.onStatusChange;
			self = undefined;
			if (notify) notify(reason || "shutdown");
		}, 1000);
	}

	function connect_listen() {
		if (!self) return;
		if (self && self.state !== STATE.ONLINE) return;
		if (self.mode !== MODE.ANNOUNCER) listenLoop();
		connectLoop();
	}

	// scan all known switches regularly to keep a good network map alive and trim the rest
	function scan() {
		if (!self) return;
		if (self.state !== STATE.ONLINE) return;

		var all = slib.getSwitches();

		// first just cull any not healthy, easy enough
		all.forEach(function (s) {
			if (!s.healthy()) s.drop();
		});

		all = slib.getSwitches();

		if (!self.broadcastMode) {
			// if only us or nobody around, and we were seeded at one point, try again!
			// unless we are the seed..
			if (all.length <= 1 && !self.seed) {
				//We probably lost our internet connection at this point.. or maybe
				//it just got disrupted:(DSL/pppoE DHCP lease renewed, if on a mobile we changed cells, signal lost etc..
				self.state = STATE.OFFLINE;
				if (self.onStatusChange) {
					self.onStatusChange("offline", "lost-seeds");
				}
				return doSeed(self.onStatusChange);
			}

			//if we lost connection to all initial seeds.. ping them all again
			var foundSeed = false;
			all.forEach(function (s) {
				if (s.seed) foundSeed = true;
			});
			if (!foundSeed) {
				pingSeeds();
			}
		}

		if (self.mode !== MODE.FULL) return;

		// TODO overall, ping first X of each bucket
		all = all.filter(function (a) {
			return (a.visible && !a.self);
		});
		all.sort(function (a, b) {
			return self.me.hash.distanceTo(a.hash) - self.me.hash.distanceTo(b.hash);
		});

		if (!all.length) return;

		// create array of arrays (buckets) based on distance from self (the heart of kademlia)
		var distance = self.me.hash.distanceTo(all[0].hash); // first bucket
		var buckets = [];
		var bucket = [];
		all.forEach(function (s) {
			var d2 = self.me.hash.distanceTo(s.hash);
			if (d2 === distance) {
				if (self.log) self.log(s.ipp, 'bucket:', buckets.length, "distance:", distance);
				return bucket.push(s);
			}
			buckets.push(bucket); //store bucket

			distance = d2;
			bucket = [s]; //put it in next bucket
			if (self.log) self.log(s.ipp, 'bucket:', buckets.length, "distance:", distance);
		});
		if (bucket.length === 1) buckets.push(bucket); //makes sure last bucket is not lost

		// TODO for congested buckets have a sort preference towards stable, and have a max cap and drop rest (to help avoid a form of local flooding)
		// for now, ping everyone!
		buckets.forEach(function (bucket) {
			bucket.forEach(function (s) {
				if (s.self) return;
				if (Date.now() < (s.ATsent + TIMERS.PING_MIN_INTERVAL)) return; // don't need to ping if already sent them a ping in the last 25sec
				doPing(s.ipp);
				// TODO, best dht mesh balance is probably to generate a random hash this distance away, but greedy +end of us is always smart/safe
			});
		});
	}

	//http://comments.gmane.org/gmane.comp.lang.javascript.nodejs/2378
	function randomString(bits) {
		var chars, rand, i, ret;
		chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		ret = '';
		// in v8, Math.random() yields 32 pseudo-random bits
		while (bits > 0) {
			rand = Math.floor(Math.random() * 0x100000000); // 32-bit integer
			// base 64 means 6 bits per character, so we use the top 30 bits from rand to give 30/6=5 characters.
			for (i = 26; i > 0 && bits > 0; i -= 6, bits -= 6) {
				ret += chars[0x3F & rand >>> i];
			}
		}
		return ret;
	}

	function nextGUID() {
		return randomString(64);
	}

})();
