#!/usr/bin/env python3
"""Builds index.html (a full standalone page for the game site) from turbo-krug.html (the artifact source,
which has no <html>/<head> wrapper and loads three.js and fonts from CDNs).

The site version loads three.js and the fonts from its own server (vendor/), so it works wherever the
CDNs are slow or blocked, and falls back to the CDN only if the local copy fails to load."""
CDN_THREE = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
LOCAL_THREE = ('<script src="three.min.js"></script>\n'
               '<script>window.THREE || document.write(\'<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\\/script>\')</script>')
FONT_LINKS = ['<link rel="preconnect" href="https://fonts.googleapis.com">\n',
              '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n',
              '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;800&family=Russo+One&display=swap">\n']

s = open('turbo-krug.html', encoding='utf-8').read()
assert CDN_THREE in s, 'three.js tag not found'
s = s.replace(CDN_THREE, LOCAL_THREE)
for i, link in enumerate(FONT_LINKS):
    assert link in s, 'font link not found'
    s = s.replace(link, '<link rel="stylesheet" href="fonts.css">\n' if i == 2 else '')
i = s.index('</style>') + len('</style>')
head = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
open('index.html', 'w', encoding='utf-8').write(head + s[:i] + '\n</head>\n<body>' + s[i:] + '</body>\n</html>\n')
print('index.html built')
