let sequence = 0;
function log() {
  const event = JSON.stringify({ pid: process.pid, sequence: ++sequence });
  console.log(event);
  console.error(event);
}
log();
setInterval(log, 100);