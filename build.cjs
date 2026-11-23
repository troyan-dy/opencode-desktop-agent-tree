// Desktop accepts one CJS file. Inline our three modules; use Desktop's own plugin and Solid runtimes.
const {readFileSync,writeFileSync}=require("node:fs");
const {join}=require("node:path");
const modules=["tree","watch","gui"].map(name=>
  `${JSON.stringify("./"+name+".cjs")}:function(require,module,exports){\n${readFileSync(join(__dirname,"src",name+".cjs"),"utf8")}\n}`);
writeFileSync(join(__dirname,"gui-experimental.cjs"),
  `"use strict";\nconst factories={${modules.join(",\n")}};\nconst cache=new Map();\n`+
  `function load(id){if(!Object.hasOwn(factories,id))return require(id);if(!cache.has(id)){const m={exports:{}};cache.set(id,m);factories[id](load,m,m.exports)}return cache.get(id).exports}\nexports.default=load("./gui.cjs").default;\n`);
