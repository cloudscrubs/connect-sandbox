var util = require('./iputil');
var os = require("os");

exports.createSocket = createSocket;

function defaultInterfaceIP(iface) {
	//iface can be an interface name string or ip address string
	//returns first ip address of interface or the ip address if it matches
	//an ipv4 external network interface address
	var ip = util.getLocalIP(iface);
	if (ip.length) return ip[0];
}

function createSocket(incomingCallback, port, interface, createdCallback, bcast) {
	var ip;
	interface = interface || "ALL";

	if (bcast || interface === "ALL") {
		/* to listen to bcast packets, we must bind to 0.0.0.0 address
		 * listening on all interfaces help to recover from network interfaces going up and down
		 */
		ip = "0.0.0.0";
	}

	if (interface === "127.0.0.1") {
		ip = interface;
	} else {
		if (!ip) ip = defaultInterfaceIP(interface);
	}

	if (!ip && interface) {
		ip = interface;
	}

	createNodeDgramSocket(incomingCallback, port, ip, createdCallback);
}

function createNodeDgramSocket(incomingCallback, port, ip, createdCallback) {
	createdCallback = createdCallback || function () {};
	var dgram = require('dgram');
	var socket = dgram.createSocket("udp4", incomingCallback);
	socket._telehash = true;

	if (port == -1) port = 42424; //default telehash port

	socket.on("listening", function () {
		socket.setBroadcast(true);
		createdCallback(undefined, socket);
	});

	socket.on("error", function (e) {
		createdCallback(e);
	});

	socket.bind(port, ip);
}
