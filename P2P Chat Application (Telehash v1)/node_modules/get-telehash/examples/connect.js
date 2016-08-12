var telehash = require("../index.js").telehash;
var connector;

telehash.init(function initialised(err) {
	if (err) {
		console.log(err);
		return;
	}
	console.log("initialised");
	telehash.seed(function (status, info) {
		if (status === 'offline' && info === 'snat-detected') {
			console.log("SNAT detected. Exiting...");
			process.exit();
		}
		if (status !== "online") {
			console.log(status);
			return;
		}
		console.log("seeded");
		connect("echo.message.back");
	});
});

function connect(name) {

	if (!connector) connector = telehash.connect(name);
	var gotResponse = false;

	connector.send("TeleHash Rocks!", function (obj) {
		if (obj) {

			console.log("Reply #" + obj.count + " MESSAGE: ", obj.message, "from:", obj.from);
			gotResponse = true;

		} else {

			if (!gotResponse) {
				console.log("No Replies! :( Retrying..");
				setTimeout(function () {
					connect(name);
				}, 100);
			} else {
				console.log("We got our replies.. yay!");
				telehash.shutdown();
				process.exit();
			}
		}
	}, 5); //timeout after 5 seconds.

}
