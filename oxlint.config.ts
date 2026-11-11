// 元にした設定: @misskey-dev/oxlint-fmt-config (MIT License, Copyright (c) 2026 Misskey Project)
import { defineConfig, type DummyRuleMap } from 'oxlint';

const jsRules: DummyRuleMap = {
	'eqeqeq': ['error', 'always', { null: 'ignore' }],
	'no-var': ['error'],
	'prefer-arrow-callback': ['error'],
	'no-throw-literal': ['error'],
	'no-param-reassign': ['warn'],
	'no-constant-condition': ['warn'],
	'no-empty-pattern': ['warn'],
	'no-async-promise-executor': ['error'],
	'no-useless-escape': ['off'],
	'no-control-regex': ['warn'],
	'no-empty': ['warn'],
	'no-inner-declarations': ['off'],
	'no-sparse-arrays': ['off'],
	'import/no-default-export': ['warn'],
};

const tsRules: DummyRuleMap = {
	'typescript/no-explicit-any': ['warn'],
	'no-unused-vars': ['warn'],
	'typescript/no-unnecessary-condition': ['warn'],
	'typescript/no-require-imports': ['warn', { allowAsImport: true }],
	'typescript/no-inferrable-types': ['warn'],
	'typescript/no-non-null-assertion': ['warn'],
	'typescript/explicit-function-return-type': ['off'],
	'typescript/no-misused-promises': ['warn', { checksVoidReturn: false }],
	'typescript/consistent-type-imports': 'off',
	'typescript/prefer-nullish-coalescing': ['warn'],
};

const stylisticRules: DummyRuleMap = {
	'@stylistic/array-bracket-spacing': ['error', 'never'],
	'@stylistic/arrow-spacing': ['error', { before: true, after: true }],
	'@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
	'@stylistic/comma-dangle': ['error', 'always-multiline'],
	'@stylistic/comma-spacing': ['error', { before: false, after: true }],
	'@stylistic/eol-last': ['error', 'always'],
	'@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
	'@stylistic/keyword-spacing': ['error', { before: true, after: true }],
	'@stylistic/indent': ['warn', 'tab', {
		SwitchCase: 1,
		MemberExpression: 1,
		flatTernaryExpressions: true,
		ArrayExpression: 'first',
		ObjectExpression: 'first',
	}],
	'@stylistic/lines-between-class-members': 'off',
	'@stylistic/no-multi-spaces': ['error'],
	'@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
	'@stylistic/object-curly-spacing': ['error', 'always'],
	'@stylistic/padded-blocks': ['error', 'never'],
	'@stylistic/nonblock-statement-body-position': ['error', 'beside'],
	'@stylistic/padding-line-between-statements': [
		'error',
		{ blankLine: 'always', prev: 'function', next: '*' },
		{ blankLine: 'always', prev: '*', next: 'function' },
	],
	'@stylistic/quotes': ['warn', 'single'],
	'@stylistic/semi': ['error', 'always'],
	'@stylistic/semi-spacing': ['error', { before: false, after: true }],
	'@stylistic/space-before-blocks': ['error', 'always'],
	'@stylistic/space-infix-ops': ['error'],
	'@stylistic/function-call-spacing': ['error', 'never'],
	'@stylistic/space-before-function-paren': ['error', {
		anonymous: 'always',
		named: 'never',
		asyncArrow: 'always',
	}],
};

export default defineConfig({
	jsPlugins: ['@stylistic/eslint-plugin'],
	options: {
		typeAware: true,
	},
	ignorePatterns: [
		'**/built',
		'**/test',
		'**/node_modules',
	],
	overrides: [
		{
			files: ['**/*.js', '**/*.jsx'],
			rules: {
				...jsRules,
				...stylisticRules,
			},
		},
		{
			files: ['**/*.ts', '**/*.tsx'],
			rules: {
				...jsRules,
				...tsRules,
				...stylisticRules,
			},
		},
	],
});
