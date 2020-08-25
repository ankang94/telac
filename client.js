const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const ipc = require('node-ipc');
const inquirer = require('inquirer');
const program = require('commander');
const pty = require('node-pty');
const { Subject } = require('rxjs');
const chalk = require('chalk');
const ansiEscapes = require('ansi-escapes');

let config = {};
let queuemsg = {
    useinfo: [],
    kickout: []
};

const CLEAN_LINE = 200;

if (fs.existsSync(path.join(__dirname, 'config.yaml'))) {
    let file = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    try {
        config = yaml.parse(file);
    } catch (error) {
        console.log(error);
    }
}

program
    .version('0.0.1')
    .requiredOption('-u, --user <string>', 'username');

program.parse(process.argv);

function welcome() {
    let output = '\n';
    output += '___________    .__                 __                \n';
    output += '\\__    ___/___ |  |   ____   _____/  |_             \n';
    output += '  |    |_/ __ \\|  |  /    \\_/ __ \\   __\\         \n';
    output += '  |    |\\  ___/|  |_|   |  \\  ___/|  |             \n';
    output += '  |____| \\___  >____/___|  /\\___  >__|             \n';
    output += `             \\/          \\/     \\/     --- HAC:${chalk.red(program.user)}\n`;
    console.log(output);
}

function changeSence(question, timeout=0) {
    setTimeout(() => {
        obv.ui.rl.output.write(ansiEscapes.eraseLines(CLEAN_LINE));
        welcome();
        prompts.next(question); 
    }, timeout);
}

function checkdeviceuse(name) {
    let handle;
    ipc.of.telac.emit('message', {
        type: 'useinfo',
        device: name
    });
    return new Promise(function (resolve, reject) {
        handle = function (data) {
            resolve(data.data);
        }
        queuemsg.useinfo.push(handle);
        setTimeout(() => {
            reject('timeout');
        }, 5000);
    }).finally(() => {
        queuemsg.useinfo = queuemsg.useinfo.filter(x => x !== handle);
    });
}

function kickoutdev(name) {
    let handle;
    ipc.of.telac.emit('message', {
        type: 'kickout',
        name: program.user,
        device: name
    });
    return new Promise(function (resolve, reject) {
        handle = function (data) {
            resolve(data.data);
        }
        queuemsg.kickout.push(handle);
        setTimeout(() => {
            reject('timeout'); 
        }, 5000);
    }).finally(() => {
        queuemsg.kickout = queuemsg.kickout.filter(x => x !== handle);
    });
}

let devicelist = Object.keys(config).filter(key => !key.startsWith('kick')).map(key => `${key} (${config[key].split(' ').join(':')})`);

const devices = {
    type: 'list',
    name: 'device',
    message: `Which devic do you want to connect?`,
    askAnswered: true,
    choices: devicelist.concat([new inquirer.Separator(), 'kick out device', {
        name: 'please ask others before operating.',
        disabled: 'operation will be recorded',
    }]),
    loop: false,
    filter: function (val) {
        return val.split(' ')[0].trim();
    }
}

const kickdev = {
    type: 'rawlist',
    name: 'kickdev',
    message: 'Please select the device to kick out!',
    askAnswered: true,
    choices: devicelist,
    loop: false,
    filter: function (val) {
        return val.split(' ')[0].trim();
    }
}

let ptyProcess = null;

let prompts = new Subject();

let obv = inquirer.prompt(prompts);

obv.ui.process.subscribe(function (answer) {
    if (answer.name === 'device' && answer.answer === 'kick') {
        changeSence(kickdev);
    } else if (answer.name === 'kickdev') {
        obv.ui.rl.output.write(ansiEscapes.eraseLines(CLEAN_LINE));
        welcome();
        console.log(`kicking out ${answer.answer}, please wait...`);
        kickoutdev(answer.answer).then((success) => {
            if (success) {
                changeSence(devices);
            } else {
                console.log(`kick out ${answer.answer} faild, please try it later.`);
                changeSence(devices, 3000);
            }
        }).catch(() => {
            console.log(`kick out ${answer.answer} timeout, please try it later.`);
            changeSence(devices, 3000);
        });
    } else {
        checkdeviceuse(answer.answer).then(user => {
            if (user) {
                console.log(`${chalk.red('>> ') + answer.answer} is used by ${chalk.red(user)}!`);
                changeSence(devices, 3000);
            } else {
                obv.ui.rl.output.mute();
                connect(answer.answer);
            }
        }).catch(error => {
            console.log('query device using timeout', error);
            changeSence(devices, 3000);
        });
    }
}, function (error) {
    process.exit(error.code);
}, function () {
    process.exit();
});

obv.ui.rl.listeners("SIGINT").forEach(listener => obv.ui.rl.off("SIGINT", listener));
obv.ui.rl.on("SIGINT", () => { });
obv.ui.rl.on("SIGTSTP", () => { });

ipc.config.socketRoot = '/tmp/';
ipc.config.stopRetrying = true;
ipc.config.silent = true;

ipc.connectTo(
    'telac',
    () => {
        ipc.of.telac.on(
            'connect',
            () => ipc.of.telac.emit('join', { name: program.user })
        );
        ipc.of.telac.on(
            'message',
            data => {
                data.type === 'useinfo' && queuemsg.useinfo.forEach(handle => handle(data));
                data.type === 'kickout' && queuemsg.kickout.forEach(handle => handle(data));
            }
        ),
        ipc.of.telac.on(
            'destroy',
            () => process.exit(1)
        ),
        ipc.of.telac.on(
            'killreq',
            data => {
                if (ptyProcess && ptyProcess.device === data.device) {
                    ptyProcess.kill("SIGINT");
                    ipc.of.telac.emit('killres', data);
                }
            }
        )
    }
);

function connect(name) {

    ptyProcess = pty.spawn('telnet', config[name].split(' '), {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
    });

    ptyProcess.on('exit', function () {
        ipc.of.telac.emit('actexit', {
            device: ptyProcess.device
        });
        ptyProcess = null;
        obv.ui.rl.output.unmute();
        changeSence(devices);
    });

    ptyProcess.on('data', function (data) {
        process.stdout.write(data);
    });

    ptyProcess.device = name;
}

process.on('exit', function () {
    obv.ui.close();
});

process.stdin.on('data', function (data) {
    const s_data = data.toString();
    if (ptyProcess) {
        if (s_data === '\x03') {
            ptyProcess.kill("SIGINT");
        } else {
            ptyProcess.write(s_data);
        }
    }
});

changeSence(devices);