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

  update(ch2, h1)
  update(ch1, h2)

  let pstream = f1.replicate(false, {live: true})
  pstream.pipe(cf1.replicate(true, {live: true})).pipe(pstream)

  pstream = f2.replicate(false, {live: true})
  pstream.pipe(cf2.replicate(true, {live: true})).pipe(pstream)

  await h1.put('key1', 'value1')
delay(100)
  await h2.put('key2', 'value2')
delay(100)
  let hb = [h1, h2, ch1, ch2]
  for (let i=0; i<hb.length; i++) {
    let hs = hb[i].createHistoryStream()
    await new Promise((resolve, reject) => {
      hs.on('data', ({value}) => {
        console.log(value)
      })
      hs.on('end', (data) => {
        resolve()
      })
    })
  }
  t.end()
})


function update(peer, main) {
  peer.feed.update(() => {
    debugger
    let rs = peer.createHistoryStream({ gte: -1 })
    rs.on('data', async (data) => {
      let { seq, key, value } = data
      debugger
      await main.put(key, value)
    })
    rs.on('end', async (data) => {
      debugger
    })
    update(peer, main)
  })
}

async function delay (ms) {
  return new Promise(resolve => setTimeout(() => resolve, ms))
}

