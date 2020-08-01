const pty = require('node-pty');
const { Subject } = require('rxjs');
const { program } = require('commander');
const inquirer = require('inquirer');

const configs = {
    sw1: '192.168.10.1',
    sw2: '192.168.10.1'
};

program
    .version('0.0.1')
    .requiredOption('-u, --user <string>', 'username');

program.parse(process.argv);

let devices = {
    type: 'list',
    name: 'device',
    message: 'Which devic do you want to connect',
    askAnswered: true,
    choices: [
        'sw1',
        'sw2',
        'kill'
    ]
}

let killdev = {
    type: 'rawlist',
    name: 'killdev',
    message: 'Please select kill device',
    askAnswered: true,
    choices: [
        'sw1',
        'sw2'
    ]
}

let prompts = new Subject();

let obv;

function welcome() {
    obv = inquirer.createPromptModule()(prompts);
    
    obv.ui.process.subscribe(function (answer) {
        if (answer.name === 'device' && answer.answer === 'kill') {
            prompts.next(killdev);
        } else if (answer.name === 'killdev') {
            setTimeout(function () {
                prompts.next(devices);
            }, 2000);
        } else {
            obv.ui.rl.output.mute();
            connect(answer.answer);
        }
    }, function (error) {
        console.log(error)
    }, function () {
        
    });
    
    obv.ui.rl.listeners("SIGINT").forEach(listener => obv.ui.rl.off("SIGINT", listener));
    obv.ui.rl.on("SIGINT", ()=>{});
    obv.ui.rl.on("SIGTSTP", ()=>{});

    prompts.next(devices);
}

welcome();

function connect(name) {

    let ptyProcess = pty.spawn('telnet', [configs[name]], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
    });

    ptyProcess.on('exit', function (code) {
        obv.ui.rl.output.unmute();
        prompts.next(devices);
    });

    ptyProcess.on('data', function (data) {
        process.stdout.write(data);
    });

    // attach handler to restore on exit
    process.on('exit', function () {
        
    });

    // attach readHandler with program logic
    process.stdin.on('data', function (data) {   
        const s_data = data.toString();
        ptyProcess.write(s_data);
    });
}

