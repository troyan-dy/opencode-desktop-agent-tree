const test=require("node:test");
const assert=require("node:assert/strict");
const {cardMap,appearance}=require("../src/cards.cjs");
const row=(id,state,children=[],agent="general")=>({id,agent,task:`Поручение ${id}`,state,children});

test("the main conversation never counts as a subagent, and task names precede role details",()=>{
  const root=row("root","Пишет ответ",[],"build");
  assert.equal(cardMap(root).count,0);
  assert.equal(cardMap(root).title,"Основной агент");
  root.children=[row("a","Работает"),row("b","Читает файл",[],"explore"),row("c","Ждёт ответа",[],"team/review")];
  const map=cardMap(root);
  assert.equal(map.count,3);
  assert.deepEqual(map.visible.map(n=>n.title),["Поручение a","Поручение b","Поручение c"]);
  assert.deepEqual(map.visible.map(n=>n.role),["Универсальный агент","Исследователь","Роль: team/review"]);
});
test("finished branches fold at their parent; a resumed grandchild reveals its whole path",()=>{
  const leaf=row("g","Завершил работу"), parent=row("p","Завершил работу",[leaf]);
  const root=row("r","Ожидает",[parent,row("a","Завершил работу"),row("err","Ошибка")]);
  let map=cardMap(root);
  assert.equal(map.count,4);
  assert.deepEqual(map.finished.map(n=>n.id),["p","a"]);
  assert.deepEqual(map.visible.map(n=>n.id),["err"]);
  leaf.state="Пишет ответ";map=cardMap(root);
  assert.deepEqual(map.visible[0].visible.map(n=>n.id),["g"]);
  assert.deepEqual(map.finished.map(n=>n.id),["a"]);
});
test("working, waiting, done, stopped, unknown, idle and errors have distinct non-color status marks",()=>{
  assert.equal(new Set(["Пишет ответ","Ждёт разрешения","Завершил работу","Остановлен","Исход неизвестен","Ожидает","Ошибка"].map(appearance)).size,7);
  assert.equal(appearance("Ждёт ответа"),appearance("Ждёт разрешения"));
  assert.equal(appearance("Выполняет команду"),appearance("Пишет ответ"));
});
