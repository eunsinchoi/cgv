const OPTIONS = {
  movie: {
    name: "오디세이",
    movNo: "30001323",
  },

  theater: {
    name: "CGV 용산아이파크몰",
    siteNo: "0013",
  },

  screen: {
    type: "IMAX", // "IMAX" 또는 "NORMAL"
    scnsNo: "018",
  },

  date: {
    watchDay: 2,
    targetDay: 3,
  },

  time: {
    preferredStarts: [
      "20:*",
      "21:*",
    ],
  },

  people: 2,

  seats: {
    allowManualOverride: true,

    rowPriority: [
      "J",
      "I",
      "K",
      "L",
      "M",
      "H",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "G",
      "F",
    ],

    centerStartNumber: 20,
    maxDistance: 20,
  },

  payment: {
    method: "toss",
    autoClickFinalPay: true,
  },
};

module.exports = OPTIONS;