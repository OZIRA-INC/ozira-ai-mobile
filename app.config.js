'use strict';

const { buildAppConfig } = require('./src/appConfig');

module.exports = ({ config }) => buildAppConfig(config, process.env.EXPO_PUBLIC_OZIRA_ENV);
