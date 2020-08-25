const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const ipc = require('node-ipc');
const log4js = require('log4js');

let config;
let devicepool = {};
let queuemsg = [];

log4js.configure({
    categories: {
        default: { appenders: ['console', 'telac'], level: 'info' }
    },
    appenders: {
        console: { type: 'console' },
        telac: {
            "type": "dateFile",
            "daysToKeep": 7,
            "maxLogSize": 5242880,
            "alwaysIncludePattern": true,
            "pattern": "yyyyMMdd.log",
            "filename": "/var/telac/telnet-ac-"
        }
    }
});

const logger = log4js.getLogger();

if (fs.existsSync(path.join(__dirname, 'config.yaml'))) {
    let file = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    try {
        config = yaml.parse(file);
    } catch (error) {
        logger.warn(`parse config yaml faild, ${error}`);
    }
}

Object.keys(config).forEach(item => {
    devicepool[item] = null;
});

ipc.config.socketRoot = '/tmp/';
ipc.config.silent = true;

ipc.config.id = 'telac';

function killDevPid(device) {
    let handle;
    ipc.server.emit(devicepool[device], 'killreq', {
        device
    });
    return new Promise(function (resolve, reject) {
        handle = function (data) {
            if (data.device === device) {
                resolve();
            }
        }
        queuemsg.push(handle);
        setTimeout(() => {
            reject('timeout');
        }, 5000);
    }).finally(() => {
        queuemsg = queuemsg.filter(x => x !== handle);
    });
}

ipc.serve(function () {
    fs.chmodSync('/tmp/app.telac', 0777);
    ipc.server.on(
        'join',
        (data, socket) => (socket.user = data.name)
    );
    ipc.server.on(
        'message',
        (data, socket) => {
            switch (data.type) {
                case 'useinfo':
                    ipc.server.emit(socket, 'message', {
                        type: 'useinfo',
                        data: devicepool[data.device] && devicepool[data.device].user
                    });
                    devicepool[data.device] || (devicepool[data.device] = socket);
                    break;
                case 'kickout':
                    if (devicepool[data.device]) {
                        killDevPid(data.device).then(() => {
                            logger.warn(`${data.name} kick out ${devicepool[data.device].user} in order to use ${data.device}`);
                            ipc.server.emit(socket, 'message', {
                                type: 'kickout',
                                data: true
                            });
                            devicepool[data.device] = null;
                        }, () => {
                            ipc.server.emit(socket, 'message', {
                                type: 'kickout',
                                data: false
                            });
                        });
                    } else {
                        ipc.server.emit(socket, 'message', {
                            type: 'kickout',
                            data: true
                        });
                    }
                    break;
                default:
                    break;
            }
        }
    );
    ipc.server.on('killres', function (data, socket) {
        queuemsg.forEach(handle => handle(data));
    });
    ipc.server.on('actexit', function (data, socket) {
        if (socket === devicepool[data.device]) {
            devicepool[data.device] = null;
        }
    });
    ipc.server.on(
        'socket.disconnected',
        function(socket, destroyedSocketID) {
            for (const [key, value] of Object.entries(devicepool)) {
                if (value === socket) {
                    devicepool[key] = null;
                }
            }
        }
    );
});

ipc.server.start();
logger.info('telac manager start success.');