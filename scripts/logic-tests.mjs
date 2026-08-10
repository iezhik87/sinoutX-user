#!/usr/bin/env node
// Детерминированные тесты алгоритмов, которые чинились в агенте (зеркалят прод-
// логику): транслит ключей реестра, локализация дат событий, бюджет истории,
// дедуп скилов. Запуск: node scripts/logic-tests.mjs — сети и ключа НЕ требует.
let pass = 0, fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n    got: ${JSON.stringify(got)}\n    exp: ${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

// 1) Транслитерация ключей реестра (create_registry)
const T={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ў:'u',є:'e',ї:'yi'}
const tr=s=>s.toLowerCase().replace(/[а-яёіўєї]/g,c=>T[c]??'')
const slug=(s,fb='')=>tr(s).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||fb
eq('translit: Препарат', slug('Препарат','x'), 'preparat')
eq('translit: Дата приёма', slug('Дата приёма','x'), 'data_priema')
eq('translit: непереводимое → фолбэк', slug('!!!','field1'), 'field1')
// ключи трёх кириллических полей — РАЗНЫЕ (был баг: все 'field')
const keys=['Препарат','Состав','Режим'].map((l,i)=>slug(l,`field${i+1}`))
eq('translit: ключи различны', new Set(keys).size, 3)

// 2) Локализация даты события (list_events): UTC-хранение → локальная дата
const MINSK=3*3600*1000
const localDate=(storedUTC)=>new Date(new Date(storedUTC).getTime()+MINSK).toISOString().slice(0,10)
eq('event date: 20 июля не съезжает на 19', localDate('2026-07-19T21:00:00Z'), '2026-07-20')
eq('event date: 1 мая не съезжает на 30 апр', localDate('2026-04-30T21:00:00Z'), '2026-05-01')

// 3) Бюджет истории: держим свежее по объёму, не по счётчику
const sizeOf=m=>(typeof m.content==='string'?m.content.length:JSON.stringify(m.content).length)+16
function trim(messages, budget, minKeep){
  let acc=0, keepFrom=0
  for(let i=messages.length-1;i>=0;i--){acc+=sizeOf(messages[i]); if(acc>budget&&(messages.length-i)>minKeep){keepFrom=i+1;break}}
  return messages.slice(keepFrom)
}
// 100 крошечных сообщений при бюджете, вмещающем все — НИЧЕГО не теряем
const many=Array.from({length:100},(_,i)=>({role:'user',content:`B${i} ${1000+i}`}))
eq('history: 100 мелких реплик влезают целиком', trim(many, 260000, 12).length, 100)
// при жёстком бюджете держим последние, но не меньше minKeep
eq('history: жёсткий бюджет — держит ровно minKeep=12', trim(many, 10, 12).length, 12)

// 4) Дедуп скилов по имени
function addSkill(tools, name){
  const norm=s=>s.trim().toLowerCase()
  const dup=tools.find(t=>norm(t.name)===norm(name))
  if(dup) return tools // обновили бы, длина не растёт
  return [...tools, {name}]
}
let sk=[]
sk=addSkill(sk,'Итоги дня'); sk=addSkill(sk,'итоги дня '); sk=addSkill(sk,'ИТОГИ ДНЯ')
eq('skill dedup: один и тот же не плодится', sk.length, 1)
sk=addSkill(sk,'Утренний бриф')
eq('skill dedup: разные — добавляются', sk.length, 2)

console.log(`\n${fail===0?'🟢 ВСЕ ПРОШЛИ':'🔴 ЕСТЬ ПАДЕНИЯ'}: ${pass} pass, ${fail} fail`)
process.exit(fail?1:0)
