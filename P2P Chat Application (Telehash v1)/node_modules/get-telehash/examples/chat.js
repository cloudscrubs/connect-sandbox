var telehash = require("../index.js").telehash;

var chatCache = {};
var connector;
var chatRoom = "telechat:lobby";
var nickName = "@user";

var stdin = process.openStdin();
stdin.setEncoding("UTF-8");

if (!process.argv[2]) {
	console.log("Usage: node chat.js nickname [chatroom]\n");
	process.exit();
}

nickName = process.argv[2];
if (process.argv[3]) chatRoom = process.argv[3];


telehash.init(function (err) {
	if (err) {
		console.log(err);
		process.exit();
		return;
	}

	telehash.seed(function (status, info) {
		if (status === 'offline' && info === 'snat-detected') {
			console.log("SNAT detected. Exiting...");
			process.exit();
		}
		if (status !== "online") {
			console.log(status);
			return;
		}
		if (!connector) {
			stdin.on('data', function (chunk) {
				if (chunk.length > 1) {
					if (connector) connector.send({
						txt: chunk,
						nick: nickName
					});
				}
			});
		}
		chat(chatRoom);
	});
});

function chat(name) {
	if (!connector) {
		connector = telehash.connect(name, true);
		telehash.listen(name, function (MSG) {
			var msg_sig = MSG.guid + MSG.message;
			if (!chatCache[msg_sig]) {
				if (MSG.message.x) {
					if (MSG.message.x == 'join') console.log("[JOINED] " + MSG.message.nick);
					if (MSG.message.x == 'leave') console.log("[LEFT THE CHAT] <" + MSG.message.nick + ">");
				} else {
					if (MSG.message.txt) console.log("<" + MSG.message.nick + ">: " + MSG.message.txt);
				}
				chatCache[msg_sig] = true;

			}
		});
	}
	console.log("Connected. Joining chat room: " + name + " as " + nickName);
	connector.send({
		x: 'join',
		nick: nickName
	});
}

//cant catch SIGINT signals on windows!
if (process.platform != 'win32') {
	process.on('SIGINT', function () {
		console.log("Use Control-D to exit.");
	});
}

stdin.on('end', function () {
	if (this.exiting) return;
	this.exiting = true;
	if (connector) connector.send({
		x: 'leave',
		nick: nickName
	});

	telehash.shutdown();
});
