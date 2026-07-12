#!/usr/bin/env python3
"""Assemble src/shell.html + src/app.js into a single self-contained index.html."""
with open('src/shell.html') as f:
    shell = f.read()
with open('src/app.js') as f:
    js = f.read()
with open('index.html', 'w') as f:
    f.write(shell.replace('__APP_JS__', js))
print('Built index.html')
