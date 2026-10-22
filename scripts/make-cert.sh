#!/usr/bin/env bash
# Generate a self-signed certificate so a phone on your LAN can use the microphone.
# Browsers require a "secure context" for getUserMedia, and http:// over a LAN IP
# is not one - so HTTPS is not optional for phone use.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

if [[ -f certs/key.pem && -f certs/cert.pem ]]; then
  echo "certs/ already present - reusing. Delete them to regenerate."
  exit 0
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"

cat > /tmp/dnd-dm-openssl.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = dnd-dm.local
[v3]
subjectAltName = DNS:localhost, IP:127.0.0.1, IP:${IP}
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -config /tmp/dnd-dm-openssl.cnf >/dev/null 2>&1

rm -f /tmp/dnd-dm-openssl.cnf

echo "Generated certs/key.pem and certs/cert.pem (valid 825 days, IP ${IP} included)."
echo "Your browser will warn once that the certificate is self-signed - that is expected."
