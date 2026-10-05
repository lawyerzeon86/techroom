#!/usr/bin/env bash
set -euo pipefail
umask 077
/usr/local/bin/duisun-backup
latest=$(find /root/duisun-backups -name 'database-*.dump' -printf '%f\n' | sort | tail -1)
test -n "$latest"
RESTORE_DB="duisun_restore_check_$(date -u +%s)_$$"
export RESTORE_DB
runuser -u postgres -- createdb "$RESTORE_DB"
trap 'runuser -u postgres -- dropdb "$RESTORE_DB"' EXIT
cat "/root/duisun-backups/$latest" | runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_DB"
runuser -u postgres -m -- node --input-type=module <<'NODE'
import pg from 'pg';
import assert from 'node:assert/strict';
const live=new pg.Pool({connectionString:process.env.DATABASE_URL});
const restored=new pg.Pool({host:'/var/run/postgresql',user:'postgres',database:process.env.RESTORE_DB});
try{
  const tables=(await live.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' OR schemaname LIKE '%archive%' ORDER BY 1,2")).rows;
  const q=s=>'"'+s.replaceAll('"','""')+'"';
  for(const t of tables){
    const sql=`SELECT count(*) FROM ${q(t.schemaname)}.${q(t.tablename)}`;
    assert.equal((await live.query(sql)).rows[0].count,(await restored.query(sql)).rows[0].count,t.tablename);
  }
  console.log('BACKUP_RESTORE_VERIFIED',JSON.stringify({tables:tables.length}));
}finally{await live.end();await restored.end();}
NODE
