// db.js - simples wrapper IndexedDB usando idb-like minimal
const DB_NAME = 'lavanderia_db_v1';
const DB_VERSION = 6;
let dbPromise;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      const tx = e.target.transaction;
      if(!db.objectStoreNames.contains('clients'))        db.createObjectStore('clients',        {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('machines'))       db.createObjectStore('machines',       {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('processes'))      db.createObjectStore('processes',      {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('records'))        db.createObjectStore('records',        {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('outbox'))         db.createObjectStore('outbox',         {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('users'))          db.createObjectStore('users',          {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('vazoes'))         db.createObjectStore('vazoes',         {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('vazao_records'))  db.createObjectStore('vazao_records',  {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('recipes'))        db.createObjectStore('recipes',        {keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('recipe_products'))db.createObjectStore('recipe_products',{keyPath: 'id', autoIncrement: true});
      if(!db.objectStoreNames.contains('client_notes'))   db.createObjectStore('client_notes',   {keyPath: 'id', autoIncrement: true});

      // v4 → v5: popular machine_ids a partir de machine_id nas receitas existentes
      if (e.oldVersion >= 1 && e.oldVersion < 5 && db.objectStoreNames.contains('recipes')) {
        const store = tx.objectStore('recipes');
        store.openCursor().onsuccess = function(ev) {
          const cursor = ev.target.result;
          if (!cursor) return;
          const r = cursor.value;
          if (!r.machine_ids) {
            r.machine_ids = JSON.stringify(r.machine_id ? [r.machine_id] : []);
            cursor.update(r);
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
  return dbPromise;
}

async function put(store, item){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const r = s.put(item);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function add(store, item){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const r = s.add(item);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function getAll(store){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const r = s.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function getById(store, id){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const r = s.get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function clearStore(store){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const r = s.clear();
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  });
}

// expose globally for simple usage from app.js
window.openDB = openDB;
window.dbPut = put;
window.dbAdd = add;
window.getAll = getAll;
window.getById = getById;
window.clearStore = clearStore;
