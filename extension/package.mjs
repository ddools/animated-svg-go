// pnpm ext:package: zips a local .vsix by hand, because vsce isn't an approved dependency. Build first.
// See docs/ARCHITECTURE.md section 9. If VS Code ever refuses the file, bring vsce back as a question.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${dir}package.json`, 'utf8'));
const stage = `${dir}.vsix`;
const vsix = `${dir}${pkg.name}-${pkg.version}.vsix`;

rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}/extension`, { recursive: true });
for (const file of ['package.json', 'extension.cjs', 'README.md']) copyFileSync(`${dir}${file}`, `${stage}/extension/${file}`);
cpSync(`${dir}media`, `${stage}/extension/media`, { recursive: true });
copyFileSync(`${root}public/apple-touch-icon.png`, `${stage}/extension/icon.png`);
copyFileSync(`${root}LICENSE`, `${stage}/extension/LICENSE.txt`);

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const asset = (type, path) => `<Asset Type="${type}" Path="extension/${path}" Addressable="true" />`;
writeFileSync(
  `${stage}/extension.vsixmanifest`,
  `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Categories>${xml(pkg.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${xml(pkg.repository.url)}" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    ${asset('Microsoft.VisualStudio.Code.Manifest', 'package.json')}
    ${asset('Microsoft.VisualStudio.Services.Content.Details', 'README.md')}
    ${asset('Microsoft.VisualStudio.Services.Content.License', 'LICENSE.txt')}
    ${asset('Microsoft.VisualStudio.Services.Icons.Default', 'icon.png')}
  </Assets>
</PackageManifest>
`,
);

// One content type per file extension in the package.
const TYPES = { '.json': 'application/json', '.cjs': 'application/javascript', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/markdown', '.txt': 'text/plain', '.vsixmanifest': 'text/xml' };
const extensions = new Set(readdirSync(stage, { recursive: true }).map((path) => extname(String(path))).filter(Boolean));
const unknown = [...extensions].filter((extension) => !TYPES[extension]);
if (unknown.length) throw new Error(`No content type for ${unknown.join(', ')}. Add it to TYPES.`);
writeFileSync(
  `${stage}/[Content_Types].xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${[...extensions].map((extension) => `  <Default Extension="${extension}" ContentType="${TYPES[extension]}" />`).join('\n')}
</Types>
`,
);

rmSync(vsix, { force: true });
// -X leaves out macOS extended attributes. Run from inside the stage so paths start at its root.
execFileSync('zip', ['-r', '-X', '-q', vsix, '.'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`Packaged ${vsix}`);
