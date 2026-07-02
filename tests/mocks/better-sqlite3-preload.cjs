'use strict';

const Module = require('module');
const originalLoad = Module._load;
let nextUserId = 1;
const users = [];
const kv = new Map();

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = String(sql || '');
    this.normalized = normalizeSql(sql);
  }

  run(...params) {
    const sql = this.normalized;
    if (sql.startsWith('insert into users')) {
      const username = String(params[0] || '');
      const passwordHash = String(params[1] || '');
      const existing = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (existing) {
        const err = new Error('UNIQUE constraint failed: users.username');
        err.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      }
      const row = { id: nextUserId++, username, password_hash: passwordHash };
      users.push(row);
      return { changes: 1, lastInsertRowid: row.id };
    }
    if (sql.startsWith('insert') || sql.startsWith('update') || sql.startsWith('delete') || sql.startsWith('replace')) {
      return { changes: 1, lastInsertRowid: 1 };
    }
    return { changes: 0, lastInsertRowid: 0 };
  }

  get(...params) {
    const sql = this.normalized;
    if (sql.includes('from users') && sql.includes('lower(username) = lower')) {
      const username = String(params[0] || '');
      const row = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!row) return undefined;
      if (sql.startsWith('select id from users')) return { id: row.id };
      return { ...row };
    }
    if (sql.includes('from users') && sql.includes('where id =')) {
      const id = Number(params[0]);
      const row = users.find((u) => u.id === id);
      return row ? { ...row } : undefined;
    }
    if (sql.includes('count(*)')) return { count: 0, total: 0, 'count(*)': 0 };
    if (sql.includes('from user_notification_settings')) return undefined;
    if (sql.includes('from user_active_agent')) return undefined;
    if (sql.includes('from user_agent_preferences')) return undefined;
    if (sql.includes('from codex_quota_state')) return undefined;
    return undefined;
  }

  all() {
    return [];
  }

  iterate() {
    return [][Symbol.iterator]();
  }

  pluck() { return this; }
  raw() { return this; }
  bind() { return this; }
}

class MockDatabase {
  constructor(filename) {
    this.name = filename;
    this.open = true;
    kv.set('filename', filename);
  }
  pragma() { return []; }
  exec() { return this; }
  prepare(sql) { return new MockStatement(this, sql); }
  transaction(fn) {
    const wrapped = (...args) => fn(...args);
    wrapped.default = wrapped;
    return wrapped;
  }
  close() { this.open = false; }
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'better-sqlite3') {
    return MockDatabase;
  }
  return originalLoad.call(this, request, parent, isMain);
};
