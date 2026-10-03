// Editor-only delimiter affordances for the accepted grasp-braces-1 profile.
// This recognizes an unambiguous token prefix, never definitions or values.
// Host parsing remains authoritative; malformed prefixes receive plain typing.
export type LiteralPair = { opening: number; closing: number; layers: number };
const name = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;
function skipSpace(source: string, at: number, end: number) { while (at<end && /[ \t\n]/.test(source[at])) at++; return at; }
function readName(source: string, at: number) { name.lastIndex=at; return name.exec(source)?.[0].length ?? 0; }
function run(source: string, at: number, character: string) { let end=at; while(source[end]===character)end++; return end-at; }

function literalPair(source: string, opening: number): LiteralPair | undefined {
  const layers=run(source,opening,"{");
  let at=opening+layers;
  const block=/^[ \t]*\n/.test(source.slice(at));
  if(block) {
    at=source.indexOf("\n",at)+1;
    while(at<source.length) {
      let first=at; while(source[first]===" " || source[first]==="\t")first++;
      if(run(source,first,"}")>=layers)return {opening,closing:first,layers};
      const end=source.indexOf("\n",at);
      if(end<0)return;
      while(at<end) {
        const count=run(source,at,source[at]);
        if((source[at]==="{" || source[at]==="}") && count>=layers)return;
        at+=count;
      }
      at=end+1;
    }
    return;
  }
  while(source.slice(at,at+2)==="\\{")at+=2;
  while(at<source.length) {
    if(source.slice(at,at+2)==="\\}") {
      let suffix=at; while(source.slice(suffix,suffix+2)==="\\}")suffix+=2;
      if(run(source,suffix,"}")>=layers)return {opening,closing:suffix,layers};
    }
    const count=run(source,at,source[at]);
    if(source[at]==="}" && count>=layers)return {opening,closing:at,layers};
    if(source[at]==="{" && count>=layers)return;
    at+=count;
  }
}

// Result: a new literal position, an existing marker to grow, or no safe help.
export function literalAction(source: string, regionStart: number, cursor: number): "open" | "blocked" | LiteralPair | undefined {
  if(!source.startsWith("@code{",regionStart))return;
  let at=regionStart+6;
  while(at<=cursor) {
    at=skipSpace(source,at,cursor);
    if(source[at]!=="@")return;
    at++;
    const length=readName(source,at); if(!length)return;
    at=skipSpace(source,at+length,cursor);
    if(source[at++]!=="=")return;
    while(at<=cursor) {
      at=skipSpace(source,at,cursor);
      if(at===cursor)return "open";
      if(source[at]==="{") {
        const pair=literalPair(source,at); if(!pair)return "blocked";
        if(pair.opening+pair.layers===cursor)return pair;
        if(pair.closing+pair.layers>=cursor)return "blocked";
        at=pair.closing+pair.layers;
      } else {
        const operand=readName(source,at); if(!operand)return;
        at+=operand;
      }
      at=skipSpace(source,at,cursor);
      if(source[at]!=="+")break;
      at++;
    }
  }
}
