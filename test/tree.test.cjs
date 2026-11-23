const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTree, executionState } = require("../src/tree.cjs");

test("opening a child shows its whole family, with historical and resumed agents exactly once", async () => {
  const row = (id, parentID, n, outcome) => ({ id, parentID, time: { created: n }, title: id, outcome });
  const rows = [row("root", null, 1), row("a", "root", 2, "succeeded"), row("b", "root", 3),
    row("grand", "a", 4, "failed"), row("other", null, 8), {...row("fork", "root", 10), fork:{sessionID:"root"}}];
  const pages = {root: {data:[rows[1]], cursor:{next:"page2"}}, page2:{data:[rows[2], rows[5]], cursor:{}},
    a:{data:[rows[3]], cursor:{}}};
  const job = (desc, started) => ({kind:"subagent", agent:"general", childSessionID:"a", sessionID:"root",
    description:desc, time:{started}});
  const client = {
    session: {get: async ({sessionID}) => rows.find(r=>r.id===sessionID),
      list: async ({parentID, cursor}) => pages[cursor || parentID] || {data:[],cursor:{}},
      active: async () => ({a:{type:"running"}})},
    message:{list: async () => ({data:[{type:"assistant", time:{created:12}, content:[{type:"text",text:"..."}]}]})},
    experimental:{job:{list: async () => [job("New assignment",10), job("Old assignment",2)]}}
  };
  const tree = await loadTree(client, "a", new AbortController().signal);
  assert.equal(tree.id,"root");
  assert.deepEqual(tree.children.map(r=>r.id),["a","b"]);
  assert.equal(tree.children[0].task,"New assignment");
  assert.equal(tree.children[0].state,"Пишет ответ");
  assert.deepEqual(tree.children[0].children.map(r=>[r.id,r.state]),[["grand","Ошибка"]]);
  assert.equal(tree.children[1].state,"Ожидает");
});

test("the current execution outranks a previous outcome or stale assistant message", () => {
  const s = {outcome:"succeeded",time:{busy:10}};
  assert.equal(executionState(s,false),"Завершил работу");
  assert.equal(executionState({...s,outcome:"interrupted"},false),"Остановлен");
  const msg = {type:"assistant",time:{created:11},content:[{type:"tool",name:"grep",state:{status:"running"}}]};
  assert.match(executionState(s,true,msg),/Ищет|grep/);
  assert.equal(executionState(s,true,{...msg,time:{created:4}}),"Работает");
  assert.equal(executionState(s,true,{...msg,time:{created:11,completed:14}}),"Работает");
  assert.equal(executionState({},false),"Ожидает");
});
