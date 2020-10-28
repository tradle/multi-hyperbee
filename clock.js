const { Timestamp, MutableTimestamp } = require('./timestamp')()

class Clock {
  constructor(clock, merkle = {}) {
    this._clock = this.makeClock(clock, merkle);
  }

  getClock() {
    return this._clock;
  }

  makeClock(timestamp, merkle = {}) {
    return { timestamp: MutableTimestamp.from(timestamp), merkle };
  }

  serializeClock(clock) {
    return JSON.stringify({
      timestamp: clock.timestamp.toString(),
      merkle: clock.merkle
    });
  }

  deserializeClock(clock) {
    const data = JSON.parse(clock);
    return {
      timestamp: Timestamp.from(Timestamp.parse(data.timestamp)),
      merkle: data.merkle
    };
  }

  makeClientId() {
    return uuidv4()
      .replace(/-/g, '')
      .slice(-16);
   }
}
module.exports = Clock