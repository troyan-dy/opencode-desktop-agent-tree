"use strict";
const roles=new Map([["general","Универсальный агент"],["explore","Исследователь"],["build","Исполнитель"],["plan","Планировщик"]]);
const marks=new Map([["Завершил работу","done"],["Ошибка","error"],["Остановлен","stopped"],["Исход неизвестен","unknown"],
  ["Ожидает","idle"],["Ждёт разрешения","wait"],["Ждёт ответа","wait"],["Повторяет запрос","retry"]]);
const appearance=state=>marks.get(state)||"work";

function cardMap(row,root=true){
  const title=root?"Основной агент":row.task||"Поручение без названия";
  const role=root?"Ведёт беседу":roles.get(row.agent)||(row.agent?`Роль: ${row.agent}`:"Субагент");
  const card={id:row.id,title,role,state:row.state,mark:appearance(row.state),count:0,visible:[],finished:[]};
  for(const child of row.children){
    const branch=cardMap(child,false);
    card.count+=1+branch.count;
    (branch.mark==="done" && !branch.visible.length?card.finished:card.visible).push(branch);
  }
  return card;
}
module.exports={cardMap,appearance};
