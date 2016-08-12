var os = require('os');

exports.getLocalIP = get_local_ip_addresses;
exports.isLocalIP = is_local_ip;
exports.isSameIP = is_same_ipp;
exports.isPrivateIP = is_private_ip;
exports.isPublicIP = is_public_ip;
exports.IP = IP;
exports.PORT = PORT;

//return list of local IP addresses
function get_local_ip_addresses(useInterface) {
	var addresses = [];
	var ifaces = os.networkInterfaces();
	for (var dev in ifaces) {
		ifaces[dev].forEach(function (details) {
			if (details.internal) return;
			if (details.family === 'IPv4') {
				if (useInterface) {
					if ((dev === useInterface) || (details.address === useInterface)) {
						addresses.push(details.address);
					}
				} else {
					addresses.push(details.address);
				}
			}
		});
	}

	return addresses;
}

function is_local_ip(ip) {
	var local = get_local_ip_addresses();
	var isLocal = false;
	local.forEach(function (local_ip) {
		if (local_ip == IP(ip)) isLocal = true;
	});
	return isLocal;
}

function IP(ipp) {
	var ip;
	if (ipp.indexOf(':') > 0) {
		ip = ipp.substr(0, ipp.indexOf(':'));
	} else {
		ip = ipp;
	}
	return ip;
}

function PORT(ipp) {
	return parseInt(ipp.substr(ipp.indexOf(':') + 1));
}

function is_same_ipp(a, b) {
	return (IP(a) == IP(b));
}

function is_public_ip(ipp) {
	return !is_private_ip(ipp);
}

function is_private_ip(ipp) {
	var ip = IP(ipp);
	if (ip.indexOf('127.0.0.1') === 0) return true;
	if (ip.indexOf('10.') === 0) return true;
	if (ip.indexOf('192.168.') === 0) return true;
	if (ip.indexOf('172.16.') === 0) return true;
	if (ip.indexOf('172.17.') === 0) return true;
	if (ip.indexOf('172.18.') === 0) return true;
	if (ip.indexOf('172.19.') === 0) return true;
	if (ip.indexOf('172.20.') === 0) return true;
	if (ip.indexOf('172.21.') === 0) return true;
	if (ip.indexOf('172.22.') === 0) return true;
	if (ip.indexOf('172.23.') === 0) return true;
	if (ip.indexOf('172.24.') === 0) return true;
	if (ip.indexOf('172.25.') === 0) return true;
	if (ip.indexOf('172.26.') === 0) return true;
	if (ip.indexOf('172.27.') === 0) return true;
	if (ip.indexOf('172.28.') === 0) return true;
	if (ip.indexOf('172.29.') === 0) return true;
	if (ip.indexOf('172.30.') === 0) return true;
	if (ip.indexOf('172.31.') === 0) return true;
	if (ip.indexOf('0.') === 0) return true;
	if (ip.indexOf('255.') === 0) return true;

	return false;
}
