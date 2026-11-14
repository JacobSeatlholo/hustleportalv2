import re,sys,urllib.parse,subprocess,html
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
q=urllib.parse.quote(sys.argv[1])
out=subprocess.run(["curl","-skL","--max-time","20","-A",UA,f"https://www.search.ch/search/?q={q}"],capture_output=True,text=True).stdout
seen=set()
for m in re.finditer(r'<a href="//search\.ch/web/r/redirect\?[^"]*?/(https?://[^"]+?)" class="sl-gus-result-title">(.*?)</a>',out,re.S):
    url=m.group(1); title=html.unescape(re.sub(r'<[^>]+>','',m.group(2))).strip()
    if url in seen: continue
    seen.add(url)
    print(f"{title[:85]} ||| {url}")
# also grab url-line anchors (class sl-gus-result-url) in case title missing
for m in re.finditer(r'class="sl-gus-result-url" href="[^"]*?/(https?://[^"]+?)"',out):
    if m.group(1) not in seen:
        seen.add(m.group(1)); print("(url-only) ||| "+m.group(1))
