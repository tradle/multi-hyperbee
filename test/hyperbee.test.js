const test = require('tape')
const Hyperbee = require('hyperbee')
const hypercore = require('hypercore')
const ram = require('random-access-memory')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }

test('Hyperbee - metadata bug', async t => {
  let f1 = hypercore(ram)
  let f2 = hypercore(ram)
  let h1 = new Hyperbee(f1, OPTIONS)
  let h2 = new Hyperbee(f2, OPTIONS)
  await h1.ready()
  await h2.ready()

  let cf1 = hypercore(ram, f1.key)
  let cf2 = hypercore(ram, f2.key)
  let ch1 = new Hyperbee(cf1, OPTIONS)
  let ch2 = new Hyperbee(cf2, OPTIONS)
  await ch1.ready()
  await ch2.ready()

  update(ch2, '2')
  update(ch1, '1')

  let stream1 = f1.replicate(false, {live: true})
  stream1.pipe(cf1.replicate(true, {live: true})).pipe(stream1)

  // Some strange thing.
  // If I comment out the next 2 lines, there is no error
  let stream2 = f2.replicate(false, {live: true})
  stream2.pipe(cf2.replicate(true, {live: true})).pipe(stream2)

  t.end()
})
function update(peer) {
  peer.feed.update(() => {
    let rs = peer.createHistoryStream({ gte: -1 })
    rs.on('data', async (data) => {
      console.log(data)
    })
    update(peer)
  })
}

