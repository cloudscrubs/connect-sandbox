var client = new WebTorrent()

document.getElementById('seed_file').addEventListener('change', handleFileSelect, false)

function handleFileSelect(ev) {
  ev.preventDefault()
  client.seed(this.files[0], onTorrent)
}
function onTorrent (torrent) {
  console.log('Torrent info hash: ' + torrent.infoHash)
  document.getElementById("seed_log").innerHTML = 'Torrent info hash: ' + torrent.infoHash
}
