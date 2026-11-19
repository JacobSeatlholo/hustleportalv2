# Bootstrapper: throwaway TCP Postgres on 127.0.0.1:55432 using the real
# binaries bundled with the pip pgserver package (no root needed).
# Exercises the nasty column types (FKs, bigint, timestamptz, jsonb, bytea,
# nulls). Prints a TCP connection URI on stdout for the node test harness.
import os
import subprocess
import sys
import time

BIN = '/home/z/.venv/lib/python3.12/site-packages/pgserver/pginstall/bin'
PGDATA = '/tmp/pgdumptest-tcp'
PORT = 55432
ENV = {**os.environ, 'LD_LIBRARY_PATH': os.path.join(BIN, '..', 'lib')}

for f in ('pg_ctl', 'initdb', 'psql'):
    assert os.path.exists(os.path.join(BIN, f)), f'missing {f}'

if not os.path.exists(os.path.join(PGDATA, 'PG_VERSION')):
    subprocess.run([os.path.join(BIN, 'initdb'), '-D', PGDATA, '-U', 'postgres'],
                   env=ENV, check=True, capture_output=True)

# Fresh start every run: stop any stale postmaster on this datadir first.
subprocess.run([os.path.join(BIN, 'pg_ctl'), '-D', PGDATA, 'stop', '-m', 'immediate'],
               env=ENV, capture_output=True)
subprocess.run([os.path.join(BIN, 'pg_ctl'), '-D', PGDATA, '-o',
                f'-c listen_addresses=127.0.0.1 -p {PORT}', '-l', '/tmp/pgdumptest.log',
                'start'], env=ENV, check=True, capture_output=True)
time.sleep(1)

PSQL = [os.path.join(BIN, 'psql'), '-h', '127.0.0.1', '-p', str(PORT), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
subprocess.run(PSQL + ['-c', 'DROP TABLE IF EXISTS child_tbl, parent_tbl CASCADE'], check=True, capture_output=True)
subprocess.run(PSQL, input="""
  CREATE TABLE parent_tbl (id bigserial PRIMARY KEY, name text, meta jsonb, avatar bytea, created timestamptz DEFAULT now());
  CREATE TABLE child_tbl (id bigserial PRIMARY KEY, parent_id bigint REFERENCES parent_tbl(id), note text, amount numeric(10,2), seen boolean DEFAULT false);
  INSERT INTO parent_tbl (name, meta, avatar) VALUES
    ('Kelo', '{"slug":"trinitydirect","score":42}', decode('ABCD','base64')),
    (NULL, NULL, NULL);
  INSERT INTO child_tbl (parent_id, note, amount) VALUES (1, 'hello', 550.00), (NULL, NULL, NULL);
""", text=True, check=True, capture_output=True)

print(f'postgresql://postgres@127.0.0.1:{PORT}/postgres')
sys.exit(0)
