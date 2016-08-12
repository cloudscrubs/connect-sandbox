/*
Switch Operating Modes

Announcer:
Only dials and sends signals, doesn't process any commands other than .see and
doesn't send any _ring, possibly short-lived.

Listener:
Stays running, also supports returning basic _ring/_line/_br so that it can
send .tap commands in order to receive new signals, but processes no other commands.

Full:
Supports all commands and relaying to any active .tap
Full Switches need to implement seeding, keeping lines open, a basic bucketing system
that tracks active Switches at different distances from themselves. A Full Switch needs
to do basic duplicate detection, it should only process a unique set of signals at
most once every 10 seconds
*/

exports.MODES = {
	FULL: 3,
	LISTENER: 2,
	ANNOUNCER: 1
};
