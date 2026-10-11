import joplin from 'api';

joplin.plugins.register({
	onStart: async function() {
		// Build step 1 (SPEC.md section 12) only adds the logic modules and
		// their tests. Commands and settings arrive in step 2.
	},
});
