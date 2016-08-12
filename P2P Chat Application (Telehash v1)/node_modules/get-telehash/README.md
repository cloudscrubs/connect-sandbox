## TeleHash v1

TeleHash is a wire protocol for exchanging JSON in a **real-time** and fully de-centralized manner, enabling applications to connect directly and **participate as servers** on the edge of the network.
It is designed to **efficiently route and distribute** small bits of data in order for applications to **discover each other** directly or in relation to events around piece of shared content.
The core benefits of TeleHash over other similar platforms and protocols is that it is both generic (not tied to any specific application or content structures) and is **radically decentralized** with **no servers or points of central control.**

This work is a continuation of [Jeremie Miller's](https://github.com/quartzjer/TeleHash) early implementation of the telehash protocol v1 spec.
v1 is incompatible with the latest version of the spec at [telehash.org](http://telehash.org)

[Original v1 spec documentation.](https://github.com/mnaamani/node-telehash/blob/master/spec)

## Install the module from npm

	npm install get-telehash

## Using telehash

	var telehash = require("get-telehash").telehash;

### telehash.init()

First required step is to **initialise** the telehash module:

	telehash.init(function(err){
		if(err){
			return; //network problem - cannot continue.
		}
		//ready to join DHT (seed)
	});

We can optionally initialise telehash network with options:

	telehash.init({
		mode: telehash.MODE.LISTENER,
		seeds: ["178.79.135.146:42424", "178.79.135.146:42425"],
		broadcastMode: false,
		respondToBroadcasts: false,
		interface: "eth0", /* interface name, or ip address, or "ALL"
		port: 20000,
		socket: require("dgram").createSocket("udp4").bind(20000)
		/* socket can be a normal node dgram sockket or any object
		 that has a dgram socket API. interface and port are ignored if we pass in a socket*/
	},function(err){
		if(!err) telehash.seed();
	});

### telehash.seed()

Once telehash is initialised we can try to go online by joining the network. This is called **seeding** into the DHT. Call the telehash.seed() method and provide a status update callback function:

	telehash.seed(function(status,info){
		switch (status){
			case "not-initialised":
				console.log("need to call telehash.init() first");
				break;
			case "online":
				console.log("online our address:",info);
				break

			case "offline":
				console.log("went offline, reason:",info);
				if(info==='snat-detected') console.log("telehash will not work behind SNAT ")
				break;

			case "connecting":
				console.log("seeding...");
				break;

			case "shutdown":
				console.log("shutting down, reason:",info);
				break;
		}
	});

Telehash will continuously try to seed and remain connected to the network. The callback will be called on connection status changes.

Telehash will shutdown and stop trying to connect if the underlying network socket is closed or if we manually shutdown telehash, with the telehash.shutdown() method. In which case we would have to re-initialise telehash.

During seeding if telehash detects that we are behind an SNAT/router or firewall, it will stop trying to connect and remain offline until we call telehash.seed() again.
We would have to use uPNP/PCP or manually port mapping/forwarding to get around this issue.

### telehash.mode()
Returns the mode we are running in. There are three modes:

	telehash.MODE.ANNOUNCER
	telehash.MODE.LISTENER
	telehash.MODE.FULL

The default mode if not set during initialising is LISTENER
See [mode.js](https://github.com/mnaamani/node-telehash/blob/master/lib/modes.js) for explanation of each mode.

### telehash.address()
Returns our address used in the DHT.

	{
		address: "128.1.4.20",
		port: 53012
	}

### telehash.peers()
Returns an array of ip:port addresses of peers in the network:

	[ "178.79.135.146:42424",
	  "178.79.135.146:42425",
	  .... ]

### telehash.state()
Returns the current network connectivity state which could be one of:

	telehash.STATE.OFFLINE
	telehash.STATE.SEEDING
	telehash.STATE.ONLINE

### telehash.uptime()

Returns the number of seconds we have been in ONLINE state, 0 if we are offline or seeding.

### telehash.nat()

Returns true if we are online and operating behind a NAT  router/firewall.

### telehash.offline([reason])
Force telehash to go offline with optional reason, which will be the "info" parameter in the status update callback.

### telehash.shutdown([reason])
Disconnect from the DHT with optional reason, which will be the "info" parameter in the status update callback.
Closes the network socket, unless the underlying dgram socket was passed in during initialisation.

## Low-Level DHT functions

`dial()`, `announce()`, `tap()` and `send()` are the building blocks to using the telehash protocol.

### telehash.dial( end_name )
Dial once to find the closest switches to that end_name.

	telehash.dial( '@telehash' );

Telehash must be online for the dial to occur.

### telehash.announce(end_name, signals )
Send signals into the network aimed at the end_name.

	telehash.announce( '@telehash', {'+foo':'abcd'} );

Telehash must be online for the dial to occur.

### telehash.tap(end_name, rule, callback )
Creates a simple listener and sends out regular .tap requests to the switches closest to end_name for signals expressed in a single rule object. When switches forward signals (a telex with only signals) to our switch matching the tap rule the callback function is called passing a copy of
the telex and the switch (sw) which forwarded the telex.

	var listener = telehash.tap( '@telehash', {
		"is":{
			"+end":"18a8912b4cf128..."
		},
		"has":["+wall"]
	}, function(sw,telex){

	});

The listener will remain active until we turn it off:

	listener.off = true;

### telehash.send(to, telex)
To send a telex directly to a switch given by it's ip and port.

	telehash.send('208.68.164.253:42424', {'+end':'1a2b3c...'} );


[wall.js](https://github.com/mnaamani/node-telehash/blob/master/examples/wall.js) has a detailed example of using all the functions.

## Simple Request/Response API
`listen()` and `connect()` can be used to for simple request/response message exchange.
Exchanged messages (string or JSON) must be small enough to fit in a single telex, and there is no guarantee of delivery.

### telehash.listen( end_name, callback )

	telehash.listen('echo', function (request) {
		console.log(request.message);
	});


This will actively wait for any connect requests sent to the provided id 'echo'.
For each incoming request the callback is called with a **request** object:

	{
	  guid:    "9S13NyQoGt1",    // the +connect signal from underlying telex
	  message: "TeleHash Rocks!" // the +message signal
	  from:    "cbfd90dd186722e1aa9a73d7a20f5af5562d5f80" //the +from signal
	  source:  "208.68.163.247:42424" //the ip:port of the relaying switch
	  reply:   function(message){..} // for replying to the sender of the telex
	}

To send a response:

	request.reply('It sure does!');

See [listen.js](https://github.com/mnaamani/node-telehash/blob/master/examples/listen.js) for a detailed example.


### telehash.connect(end_name)
`connect()` will return a connector object. In the background the connector will use the DHT to
find anyone listening for the end_name.

	var connector = telehash.connect("echo");

### connector.send( message, [callback, timeout_s] )

Using the connector's send function we can then send actual messages to active listeners.
Replies will fire the callback function, with a response object.

	connector.send( 'TeleHash Rocks!', function(response){
		console.log( response.message );
	},timeout_s);

The send function takes optional callback function and timeout parameters.
Responses must arrive within the specified timeout_s (in seconds) (or default 10 seconds) period or they will get discarded.
The callback will always be fired after timeout period expires with an empty (undefined) response object.

The response object will look like:

	{
		from:     '212.13.155.60:5432',   // ip:port of the relaying switch
		message:  'It sure does!',   // the +message signal in the underlying telex
		count:    3  // total responses received so far
	}

See [connect.js](https://github.com/mnaamani/node-telehash/blob/master/examples/connect.js) for a detailed example.

More advanced examples:

[chat.js](https://github.com/mnaamani/node-telehash/blob/master/examples/chat.js)

[talk.js](https://github.com/mnaamani/node-telehash/blob/master/examples/talk.js)

### Links
[Kademlia DHT](http://en.wikipedia.org/wiki/Kademlia)

[NAT](http://en.wikipedia.org/wiki/Network_address_translation)
