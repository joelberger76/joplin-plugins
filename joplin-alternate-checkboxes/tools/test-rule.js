// Checks the built content script against markdown-it. Run "npm run dist" first.
const assert = require('assert');
const path = require('path');
const MarkdownIt = require('markdown-it');
const script = require(path.join(__dirname, '..', 'dist', 'altCheckboxes.js'));
const factory = script.default.default || script.default;
const taskTypes = require(path.join(__dirname, '..', 'src', 'taskTypes.json'));

function render(source, options) {
	const md = new MarkdownIt(options);
	md.use(factory().plugin);
	return md.render(source);
}

let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`ok - ${name}`); }

check('every listed character becomes an icon item and loses its marker', () => {
	for (const char of Object.keys(taskTypes)) {
		const html = render(`- [${char}] buy milk`);
		assert(html.includes('class="alt-checkbox"'), `no class for [${char}]: ${html}`);
		assert(html.includes('>buy milk<'), `marker left behind for [${char}]: ${html}`);
	}
});
check('data-task carries the character', () => {
	assert(render('- [/] a').includes('data-task="/"'));
	assert(render('- [>] a').includes('data-task="&gt;"'));
	assert(render('- ["] a').includes('data-task="&quot;"'));
});
check('standard checkboxes, unknown characters and plain items are untouched', () => {
	for (const src of ['- [ ] a', '- [x] a', '- [X] a', '- [1] a', '- [z] a', '- plain', '- [link] a']) {
		assert(!render(src).includes('alt-checkbox'), src);
	}
});
check('needs whitespace after the bracket, so links are untouched', () => {
	assert(!render('- [i](https://example.com) a').includes('alt-checkbox'));
	assert(!render('- [i]a').includes('alt-checkbox'));
});
check('ordered lists and paragraphs are untouched', () => {
	assert(!render('1. [/] a').includes('alt-checkbox'));
	assert(!render('[/] a').includes('alt-checkbox'));
});
check('escaped brackets opt out', () => {
	assert(!render('- \\[/] a').includes('alt-checkbox'));
});
check('inline formatting after the marker survives', () => {
	const html = render('- [*] **bold** and *em*');
	assert(html.includes('data-task="*"') && html.includes('<strong>bold</strong>') && html.includes('<em>em</em>'), html);
});
check('star marker swallowed by emphasis is left as written', () => {
	const html = render('- [*] foo* bar');
	assert(!html.includes('alt-checkbox') || html.includes('foo* bar'), html);
});
check('nested, loose and mixed lists', () => {
	const html = render('- [ ] todo\n- [/] half\n    - [!] deep\n\n- [?] loose\n\n- [x] done\n');
	assert.strictEqual((html.match(/alt-checkbox/g) || []).length, 3, html);
});
check('marker with no text', () => {
	assert(render('- [!]').includes('data-task="!"'));
});
check('typographer smart quotes do not break the quote marker', () => {
	const html = render('- ["] said', { typographer: true });
	assert(html.includes('alt-checkbox') && html.includes('>said<'), html);
});
check('stylesheet has a rule for every character', () => {
	const css = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'altCheckboxes.css'), 'utf8');
	for (const char of Object.keys(taskTypes)) {
		const sel = `[data-task="${char.replace(/["\\]/g, '\\$&')}"]`;
		assert(css.includes(sel), `missing ${sel}`);
	}
});
console.log(`${checks} checks passed`);
