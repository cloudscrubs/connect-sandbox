exports.STATES = {
	OFFLINE: 0, //initial state
	SEEDING: 1, //only handle packets from seeds to determine our ip:port and NAT type
	ONLINE: 2 //full packet processing
};
