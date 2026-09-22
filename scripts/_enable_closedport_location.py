import os
from io import BytesIO

import paramiko

conf = "/etc/nginx/conf.d/cng.conf"
snippet = """
    location /closedport/ {
        alias /usr/share/nginx/html/closedport/;
        autoindex off;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
        types {
            application/json json;
            application/octet-stream exe msi;
        }
    }
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    os.environ["UPDATE_HOST"],
    username=os.environ["UPDATE_USER"],
    password=os.environ["UPDATE_PASS"],
    timeout=20,
)


def run(cmd: str) -> str:
    _stdin, stdout, stderr = client.exec_command(cmd)
    return (stdout.read() + stderr.read()).decode("utf-8", "ignore")


sftp = client.open_sftp()
with sftp.open(conf, "r") as fh:
    text = fh.read().decode("utf-8")
if "location /closedport/" not in text:
    text = text.replace("    location / {", snippet + "\n    location / {", 1)
    sftp.putfo(BytesIO(text.encode("utf-8")), conf)
    print("PATCHED", conf)
else:
    print("ALREADY", conf)
sftp.close()
print(run("nginx -t && nginx -s reload"))
client.close()
