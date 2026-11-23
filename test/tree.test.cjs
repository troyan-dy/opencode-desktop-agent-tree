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
  const s = {outcome:"succeeded",time:{busy:10,idle:14}};
  assert.equal(executionState(s,false),"Завершил работу");
  assert.equal(executionState({...s,outcome:"interrupted"},false),"Остановлен");
  const msg = {type:"assistant",time:{created:11},content:[{type:"tool",name:"grep",state:{status:"running"}}]};
  assert.match(executionState(s,true,msg),/Ищет|grep/);
  assert.equal(executionState(s,true,{...msg,time:{created:4}}),"Работает");
  assert.equal(executionState(s,true,{...msg,time:{created:11,completed:14}}),"Работает");
  assert.equal(executionState({},false),"Ожидает");
});

test("an interrupted service never attributes the previous success to the next run", () => {
  for (const time of [{busy:20,idle:10},{busy:20}])
    assert.equal(executionState({outcome:"succeeded",time},false),"Исход неизвестен");
});

test("after jobs are consumed a freshly opened panel reads the last successful assignment from parent history", async () => {
  const root={id:"r",time:{created:1}}, child={id:"c",parentID:"r",title:"First",time:{created:2}};
  const call=(description,status)=>({type:"tool",name:"subagent",time:{created:6},
    state:{status,input:{description,sessionID:"c"},metadata:{sessionID:"c"}}});
  const msg=(id,parts)=>({id,type:"assistant",time:{created:5,completed:7},content:parts});
  const client={session:{get:async()=>root,active:async()=>({}),
    list:async({parentID})=>({data:parentID==="r"?[child]:[],cursor:{}})},
    experimental:{job:{list:async()=>[]}},message:{list:async({cursor})=>cursor?
      {data:[msg("m1",[call("Latest success","completed")])],cursor:{}}:
      {data:[msg("m2",[call("Ignored failure","error")])],cursor:{next:"older"}}}};
  assert.equal((await loadTree(client,"r",new AbortController().signal)).children[0].task,"Latest success");
});
