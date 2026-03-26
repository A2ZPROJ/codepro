const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(){
    const userDataPath = app ? app.getPath('userData') : path.join(require('os').homedir(), '.codepro');
    if(!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, {recursive:true});
    this.path = path.join(userDataPath, 'config.json');
    this.data = this._load();
  }
  _load(){
    try { return JSON.parse(fs.readFileSync(this.path,'utf8')); }
    catch(e){ return {}; }
  }
  _save(){ fs.writeFileSync(this.path, JSON.stringify(this.data,null,2)); }
  get(key){ return this.data[key]; }
  set(key,val){ this.data[key]=val; this._save(); }
  delete(key){ delete this.data[key]; this._save(); }
}

module.exports = Store;
