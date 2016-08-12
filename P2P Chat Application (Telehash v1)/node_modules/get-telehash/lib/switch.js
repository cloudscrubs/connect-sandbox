(function () {
	"use strict";

	var async = require('async');
	var hlib = require('./hash');
	var util = require('./iputil');
	var MODE = require('./modes.js').MODES;
	var STATE = require('./states.js').STATES;

	// global hash of all known switches by ipp
	var network = {};

	// A Full Switch needs to do basic duplicate detection, it should only process a unique set of signals at
	// most once every 10 seconds (hash the sorted string sigs/values).

	// cache: keeps tracks of processed signals
	var signalsCache = {};

	function cacheHit(telex) {
		var sigarray = [];
		var keys = Object.keys(telex);
		if (!keys) return false;
		keys.forEach(function (key) {
			if (key[0] === '+') sigarray.push(key + JSON.stringify(telex[key]));
		});

		sigarray.sort(function (a, b) {
			return (a > b);
		});

		var hash = new hlib.Hash(sigarray.join('')).toString();

		if (signalsCache[hash] && (signalsCache[hash] + 10000 > Date.now())) return true; //cache hit

		signalsCache[hash] = Date.now();
		return false; //cache miss
	}

	// callbacks must be set first, and must have
	// .data(switch, {telex for app}) and .socket_send() being udp socket send, news(switch) for new switch creation
	var master;

	exports.setCallbacks = function (m) {
		master = m;
	};
	exports.clearCallbacks = clearCallbacks;

	function clearCallbacks() {
		master = {
			data: function () {},
			signals: function () {},
			socket_send: function () {},
			news: function () {},
			state: function () {
				return 0;
			},
			mode: function () {
				return undefined;
			},
			nat: function () {
				return false;
			}
		};
	}

	clearCallbacks();

	function networkKeys() {
		var keys = Object.keys(network);
		return (keys || []);
	}

	// return array of all
	function getSwitches() {
		var arr = [];
		networkKeys().forEach(function (key) {
			arr.push(network[key]);
		});
		return arr;
	}
	exports.getSwitches = getSwitches;

	function getSwitch(ipp, arg) {
		if (network[ipp]) return network[ipp];
		return (new Switch(ipp, arg));
		// create new one!
	}
	exports.getSwitch = getSwitch;

	function knownSwitch(ipp) {
		return (ipp in network);
	}
	exports.knownSwitch = knownSwitch;

	function getSelf() {
		var me;
		networkKeys().forEach(function (key) {
			if (network[key].self === true) me = network[key];
		});
		return me;
	}

	// return array of switches closest to the endh, s (optional optimized staring switch), num (default 5, optional)
	function getNear(endh, s, num) {
		// for not just sort all, TODO use mesh, also can use a dirty list mixed with mesh
		if (!num) num = 5;
		var x = networkKeys().sort(function (a, b) {
			return endh.distanceTo(network[a].hash) - endh.distanceTo(network[b].hash);
		});

		x = x.filter(function (a) {
			var sw = network[a];
			return (sw.line && sw.visible && sw.healthy());
		});

		return x.slice(0, num);
	}
	exports.getNear = getNear;

	// every seen IPP becomes a switch object that maintains itself
	function Switch(ipp, arg) {
		// initialize the absolute minimum here to keep this lightweight as it's used all the time
		var thisSwitch = this;
		this.ipp = ipp;
		this.hash = new hlib.Hash(ipp);
		network[this.ipp] = this;
		this.end = this.hash.toString();
		if (arg) this.via = arg.via; // optionally, which switch introduced us
		this.ATinit = Date.now();
		this.misses = 0;
		this.seed = false;
		this.ip = this.ipp.substr(0, this.ipp.indexOf(':'));
		this.port = parseInt(this.ipp.substr(this.ipp.indexOf(':') + 1));
		if (arg && (arg.via || arg.init)) {
			//this switch has been .seen or we are creating it directly using 'new Switch(ipp, {init:true})'
			//pop it, ping it and open a line!
			master.news(thisSwitch);
		} else {
			//the switch is being created indirectly by getSwitch(ipp) when we get a new telex from an unknown switch
			//or when we are trying to send a telex to a yet unknown switch.
		}
		return this;
	}

	exports.Switch = Switch;

	// process incoming telex from this switch
	Switch.prototype.process = function (telex, rawlen) {
		// do all the integrity and line validation stuff
		if (!validate(this, telex)) return;


		// basic header tracking
		if (!this.BR) this.BR = 0;
		this.BR += rawlen;

		// they can't send us that much more than what we've told them to, bad!
		//BRout is how much we had received from them when we last sent them a telex
		if (this.BRout && this.BR - this.BRout > 12000) return;

		//track how much they claim they received from us
		this.BRin = (telex._br) ? parseInt(telex._br) : undefined;

		if (this.BRin < 0 && this.line && this.line === telex._line) {
			delete this.ATline;
			delete this.line;
			delete this.ring;
			delete this.ringin;
			delete network[this.ipp];
			return;
		}

		// TODO, if no ATrecv yet but we sent only a single +end last (dialing) and a +pop request for this ip, this
		// could be a NAT pingback and we should re-send our dial immediately

		// timer tracking
		this.ATrecv = Date.now();

		// responses mean healthy
		delete this.ATexpected;
		delete this.misses;

		// process serially per switch
		telex._ = this; // async eats 'this'
		if (!this.queue) this.queue = async.queue(worker, 1);
		this.queue.push(telex);
	};

	function worker(telex, callback) {
		var s = telex._;
		delete telex._; // get owning switch, repair

		//announcer only processes .see commands
		if (master.mode() === MODE.ANNOUNCER) {
			if (Array.isArray(telex['.see'])) doSee(s, telex['.see']);
			callback();
			return;
		}
		//assuming telex is validated there should be a _line open
		if (telex['_line'] && telex['_line'] === s.line) {
			if (Array.isArray(telex['.see'])) doSee(s, telex['.see']);
			if (master.mode() == MODE.FULL && Array.isArray(telex['.tap'])) doTap(s, telex['.tap']);
		}

		if (telex['+end'] && (!telex._hop || parseInt(telex._hop) === 0)) {
			if (master.mode() == MODE.FULL) doEnd(s, new hlib.Hash(null, telex['+end']));
			callback(); //dont process telex further: dial telexes should only contain an +end signal with _hop=0
			return;
		}

		// if there's any signals, check for matching taps to relay to
		if (Object.keys(telex).some(function (x) {
				return (x[0] === '+');
			}) && !(parseInt(telex['_hop']) >= 4)) {
			if (cacheHit(telex)) {
				callback();
				return;
			}
			doSignals(s, telex);
		} else {
			//else added to prevent passing telex to both master.data and master.signals if a telex contains both
			//signals and data which we are tapping for

			// if there's any raw data, send to master
			if (Object.keys(telex).some(function (x) {
					return (x[0] != '+' && x[0] != '.' && x[0] != '_');
				})) master.data(s, telex);
		}
		callback();
	}

	/*
	Notes from proto spec on dampening..
	Dampening is used to reduce congestion around any single Switch or group of them nearby when there is a lot of signals or listeners coming in around one or more Ends. There are two strategies, one when all the traffic is to a single End, and another when it's just to one part of the ring (different but nearby Ends). A Switch should not .see back to anyone the IP:PORT of any other Switch when it's _br is sufficiently out of sync with it (need to test to find an appropriate window here), this dampens general parts of the DHT when traffic might flow beyond any Switches desire or ability to respond to. Secondarily, any Switch should return itself as the endpoint for any End that is the most popular one it is seeing (also need to test to find best time window to check popularity).
	*/
	function doEnd(s, endh) {
		s.popped = true; //switch was able to contact us directly so it's 'popped'
		var me = getSelf();
		var near = getNear(endh);
		//TODO: if the nearer Switches are dampened (congestion control) .see back only ourselves.

		// only allow private IPs if we are seeding with a private DHT
		// and only allow public IPs if we are seeding with a public DHT
		var valid = near.filter(function (ipp) {
			return util.isPrivateIP(me.ipp) === util.isPrivateIP(ipp);
		});

		//see if we know of switches closer to endh than ourself
		var closer = valid.filter(function (ipp) {
			return (network[ipp].hash.distanceTo(endh) < me.hash.distanceTo(endh));
		});

		// If none are closer (relative to us) .see back only ourselves.
		if (!closer.length) closer = [me.ipp];

		s.send({
			'.see': closer.slice(0, 5)
		});
	}

	// automatically turn every new ipp into a switch, important for getNear being useful too
	function doSee(s, see) {
		var me = getSelf();
		if (!me) return; //make sure we have established our identity first..
		see.forEach(function (ipp) {

			//only allow private IPs if we are seeding with a private DHT
			//and only allow public IPs if we are seeding with a public DHT
			if (util.isPrivateIP(me.ipp) !== util.isPrivateIP(ipp)) return;

			//add switch to network later,
			//will be ping'ed on next scan interval if status is online
			(function (switchipp, via) {
				setTimeout(function () {
					if (master.state() !== STATE.ONLINE) return;
					getSwitch(switchipp, {
						via: via
					}).visible = true;
				}, 2500); //timeout should be more than SNAT_TIMEOUT
			})(ipp, s.ipp);
		});
	}

	function doTap(s, tap) {
		// do some validation?
		// todo: index these much faster
		s.rules = tap;
	}

	function doSignals(s, telex) {

		//only if we are not behind a symmetric NAT, parse the th:ipp and send them an empty telex to pop!
		//we dont need to pop if we are not behind a NAT..
		if (telex['+pop']) {
			if (master.nat()) {
				var me = getSelf();
				if (me && me.end == telex['+end']) {
					var empty_telex = new Buffer(JSON.stringify({}) + '\n', "utf8");
					var ipp = telex['+pop'].substr(3); //stip off the 'th:'
					var ip = util.IP(ipp);
					var port = util.PORT(ipp);
					try {
						master.socket_send(empty_telex, 0, empty_telex.length, port, ip);
					} catch (e) {}
					return;
				}
			}
		}

		// find any network.*.rules and match, relay the signals
		if (master.mode() == MODE.FULL) {
			getSwitches().forEach(function (aswitch) {
				if (!aswitch.rules) return; //ignore switches which dont have an active .tap
				if (aswitch.self) return; //our taps are handeled by master.signals()
				for (var i in aswitch.rules) {
					if (telexMatchesRule(telex, aswitch.rules[i])) {
						aswitch.forward(telex);
						return; //forward telex only once to the switch
					}
				}
			});
		}
		master.signals(s, telex); //pass it to user application
	}

	function telexMatchesRule(telex, rule) {

		if (!rule['is'] && !rule['has']) return false; //not a valid rule to match
		if (rule['is']) {
			var is = rule['is'];
			//match exact signal and value
			for (var key in is) {
				if (telex[key] != is[key]) return false;
			}
		}

		if (rule['has']) {
			var miss = false;
			//look only for existance of signal
			rule['has'].forEach(function (h) {
				if (!telex[h]) miss = true;
			});
			if (miss) return false;
		}
		//if we made it here telex matched rule!
		return true;
	}
	exports.ruleMatch = telexMatchesRule;

	//forward an incoming telex, strip out headers keeping signals
	Switch.prototype.forward = function (telex, arg) {
		var newTelex = {};

		Object.keys(telex).forEach(function (key) {
			//copy signals to new telex
			if (key[0] == '+') newTelex[key] = telex[key];
		});

		//increment _hop by 1
		newTelex['_hop'] = (parseInt(telex['_hop']) || 0) + 1; //receiving switch will not process +end signal as a dial

		this.send(newTelex);
	};

	// send telex to switch
	Switch.prototype.send = function (telex) {

		if (this.self) return; // flag to not send to ourselves!

		// if last time we sent there was an expected response and never got it, count it as a miss for health check
		if (this.ATexpected && this.ATexpected < Date.now()) this.misses = this.misses + 1 || 1;
		delete this.ATexpected;
		// if we expect a reponse, in 10sec we should count it as a miss if nothing
		// if we are forwarding an +end signal (_hop > 0) dont expect a .see response.
		if (telex['+end'] && (!telex._hop || telex._hop === 0)) this.ATexpected = Date.now() + 10000;

		// check bytes sent vs received and drop if too much so we don't flood
		if (!this.Bsent) this.Bsent = 0;
		if (this.Bsent - this.BRin > 10000) {
			return;
		}

		if (master.mode() != MODE.ANNOUNCER) {
			if (!this.ring) this.ring = Math.floor((Math.random() * 32768) + 1);
		}

		//make copy of telex.. and send that .. dont alter telex
		var telexOut = {};
		Object.keys(telex).forEach(function (key) {
			telexOut[key] = telex[key];
		});

		telexOut._to = this.ipp;

		if (master.mode() !== MODE.ANNOUNCER) {
			// try to handshake in case we need to talk again
			if (this.line) {
				telexOut._line = this.line;
			} else {
				telexOut._ring = this.ring;
			}
		}

		// send the bytes we've received, if any
		if (this.BR) this.BRout = this.BR;

		//if we are dropping the switch _br will have already been set to -10000
		if (!telexOut._br) telexOut._br = this.BR;

		var msg = new Buffer(JSON.stringify(telexOut) + '\n', "utf8"); // \n is nice for testing w/ netcat
		//if msg.length > 1400 //large datagram might not survive MTU

		// track bytes we've sent
		if (!this.Bsent) this.Bsent = 0;
		this.Bsent += msg.length;
		if (telexOut['+end']) {
			this.ATsent = Date.now();
		}

		if (master.packetLog) master.packetLog(">> %s (%s)", this.ipp, msg.length, msg.toString());
		try {
			master.socket_send(msg, 0, msg.length, this.port, this.ip);
		} catch (e) {}
	};

	// necessary utility to see if the switch is in a known healthy state
	Switch.prototype.healthy = function () {
		if (this.self) return true; // we're always healthy haha
		//if(!this.popped) return true; //give a chance for switch to atleast get popped
		if (this.ATinit + 10000 > Date.now()) return true; // new switches are healthy for 10 seconds!
		if (!this.ATrecv) return false; // no packet, no love
		if (Date.now() > (this.ATrecv + 60000)) return false; //haven't recieved anything in last minute
		if (this.misses > 2) return false; // three strikes
		if (this.Bsent - this.BRin > 10000) return false; // more than 10k hasn't been acked
		return true; // <3 everyone else
	};

	Switch.prototype.drop = function () {
		//delete main reference to self, should auto-GC if no others
		if (this.healthy() && this.line) {
			this.send({
				_br: -10000
			});
		}
		delete network[this.ipp];
	};

	// make sure this telex is valid coming from this switch, and twiddle our bits
	function validate(s, t) {
		// first, if it's been more than 10 seconds after a line opened,
		// be super strict, no more ringing allowed, _line absolutely required
		if (s.ATline && s.ATline + 10000 < Date.now() && t._line != s.line) return false;

		// second, process incoming _line
		if (t._line) {
			// can't get a _line w/o having sent a _ring
			if (s.ring === undefined) return false;

			// be nice in what we accept, strict in what we send
			t._line = parseInt(t._line);

			// must match if exist
			if (s.line && t._line != s.line) return false;

			// must be a product of our sent ring!!
			if (t._line % s.ring !== 0) return false;

			// we can set up the line now if needed
			if (!s.line) {
				s.ringin = t._line / s.ring; // will be valid if the % = 0 above
				s.line = t._line;
				s.ATline = Date.now();
			}
		}

		// last, process any incoming _ring's (remember, could be out of order after a _line and still be valid)
		if (t._ring) {

			// be nice in what we accept, strict in what we send
			t._ring = parseInt(t._ring);

			// already had a ring and this one doesn't match, should be rare
			if (s.ringin && t._ring != s.ringin) return false;

			// make sure within valid range
			if (t._ring <= 0 || t._ring > 32768) return false;

			// we can set up the line now if needed
			//if(s.ATline == 0){ //will never be true!

			if (master.mode() !== MODE.ANNOUNCER && !s.ATline) { //changed this to calculate the _line on first packet received from a switch with _ring
				s.ringin = t._ring;
				if (!s.ring) s.ring = Math.floor((Math.random() * 32768) + 1);
				s.line = s.ringin * s.ring;
				s.ATline = Date.now();
			}
		}

		// we're valid at this point, line or otherwise
		return true;
	}
})();
