'use strict'

const sameInbox = [
  ['derek+promo@gmail.com', 'derek@gmail.com'],
  ['d.e.r.e.k@gmail.com', 'derek@gmail.com'],
  ['D.Erek+x@gmail.com', 'derek@gmail.com'],
  ['d.erek@googlemail.com', 'derek@googlemail.com'],
  ['d.erek@googlemail.com', 'derek@gmail.com'],
  ['derek@gmail.com', 'derek@googlemail.com'],
  ['destek+6@acme.com', 'destek@acme.com'],
  ['destek+a@acme.com', 'destek+b@acme.com'],
  ['12345+x@acme.com', '12345@acme.com']
]

const numbered = [
  ['derek2@gmail.com', 'derek1@gmail.com'],
  ['derek3@gmail.com', 'derek@gmail.com'],
  ['derek12@gmail.com', 'derek@gmail.com'],
  ['1derek@hotmail.com', 'derek@hotmail.com'],
  ['d.erek7+x@gmail.com', 'derek@gmail.com'],
  ['derek1@googlemail.com', 'derek@gmail.com'],
  ['destek6@aramamotorukayit.com', 'destek@aramamotorukayit.com'],
  ['Destek6@AramaMotoruKayit.com', 'destek1@aramamotorukayit.com'],
  ['destek+6@aramamotorukayit.com', 'destek2@aramamotorukayit.com'],
  ['de.stek-2@acme.com', 'destek@acme.com'],
  ['destek_99@acme.com', 'destek.1@acme.com'],
  ['john.doe@acme.com', 'johndoe@acme.com'],
  ['de_rek@acme.com', 'derek@acme.com']
]

const strangers = [
  ['derek1985@gmail.com', 'derek2001@gmail.com'],
  ['john1987@gmail.com', 'john@gmail.com'],
  ['derek123@gmail.com', 'derek@gmail.com'],
  ['2001derek@gmail.com', 'derek@gmail.com'],
  ['jo@gmail.com', 'j.o2@gmail.com'],
  ['ab1@acme.com', 'ab@acme.com'],
  ['a1b2c@acme.com', 'abc@acme.com'],
  ['jane@gmail.com', 'john@gmail.com'],
  ['hello@microlink.io', 'joseba@microlink.io'],
  ['destekci@acme.com', 'destek@acme.com'],
  ['123@gmail.com', '456@gmail.com'],
  ['123.45@acme.com', '12345@acme.com'],
  ['12_345@acme.com', '123-45@acme.com'],
  ['12derek34@acme.com', '5derek6@acme.com'],
  ['1derek1@acme.com', 'derek@acme.com'],
  ['destek1@other.com', 'destek@aramamotorukayit.com'],
  ['destek1@sub.aramamotorukayit.com', 'destek@aramamotorukayit.com'],
  ['destek1@aramamotorukayit.com', 'destek1@aramamotorukayit.com'],
  ['not-an-email', 'destek@acme.com']
]

module.exports = { sameInbox, numbered, strangers }
