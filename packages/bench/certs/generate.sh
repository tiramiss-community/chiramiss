#!/bin/sh
# ベンチ専用の CA と origin.bench のサーバ証明書を作る。生成物はコミット済み。有効期間は 36500 日。
set -eu

cd "$(dirname "$0")"
DAYS=36500
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days "$DAYS" -subj '/CN=chiramiss bench CA' \
	-addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
	-keyout "$tmp/ca-key.pem" -out ca.pem

openssl req -newkey rsa:2048 -nodes -subj '/CN=origin.bench' -keyout origin-key.pem -out "$tmp/origin.csr"

printf 'subjectAltName=DNS:origin.bench\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > "$tmp/ext.cnf"

openssl x509 -req -in "$tmp/origin.csr" -CA ca.pem -CAkey "$tmp/ca-key.pem" -CAserial "$tmp/ca.srl" -CAcreateserial \
	-days "$DAYS" -extfile "$tmp/ext.cnf" -out origin.pem

chmod 0644 ca.pem origin.pem origin-key.pem
