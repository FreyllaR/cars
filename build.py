#!/usr/bin/env python3
"""Builds index.html (a full standalone page) from turbo-krug.html (the artifact source, which has no <html>/<head> wrapper)."""
s = open('turbo-krug.html', encoding='utf-8').read()
i = s.index('</style>') + len('</style>')
head = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
open('index.html', 'w', encoding='utf-8').write(head + s[:i] + '\n</head>\n<body>' + s[i:] + '</body>\n</html>\n')
print('index.html built')
