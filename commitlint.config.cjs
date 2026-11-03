module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['web', 'api', 'mobile', 'shared', 'config', 'ci', 'deps', 'docs', 'repo'],
    ],
  },
};
