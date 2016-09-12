var client = new WebTorrent()

document.getElementById('seed_file').addEventListener('change', seedFile, false)
document.getElementById('start_download').addEventListener('click', downloadFile)


// Downloading a File
function downloadFile(ev) {
  ev.preventDefault()
  var torrentId = String(document.getElementById('torrentId').value)
  client.add(torrentId, onTorrent)
}

function onTorrent (torrent) {
  console.log("onTorrent")
}

// Seeding a File
function seedFile(ev) {
  ev.preventDefault()
  client.seed(this.files[0], onSeed)
}

function onSeed (torrent) {
  console.log("onSeed")
  document.getElementById("seed_log").innerHTML = 'Torrent info hash: ' + torrent.infoHash + '<br>'
}
