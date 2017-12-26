
const TelegramBot = require('node-telegram-bot-api');
const token = '489162319:AAGvEFzLdsKSiMRTVAlEts5bSILEuoq7Ufs';
const bot = new TelegramBot(token, {polling: true});
const db = require('./data/db');
const request = require('request');

bot.onText(/\/start/, (msg) => {
    const id = msg.from.id;
    const chatId = msg.chat.id;
    let contact;
    db.find({where: {userId: id}})
        .then(user => {
            if (!user) {
                db.create({userId: id})
            }
            
            if (!user || user.phone === null) {
                contact = { text: "Отправить контакты", request_contact: true }
            } else {
                contact = { text: user.phone}
            }
            if (user && user.stage == 0 || !user) {
                var options = {
                    "parse_mode": "Markdown",
                    "reply_markup": JSON.stringify({
                        "keyboard": [[contact]],
                        "one_time_keyboard" : true,
                        "resize_keyboard":true
                    })
                };
                db.update({stage: 1}, {where: {userId: id}}).then (user => {
                    bot.sendMessage(chatId, "Здравствуйте! Это сервис Намба такси, где вы сможете заказать такси в несколько нажатий, для начала выберите номер телефона, на который вы хотите заказать такси.", options);
                })
            }
        })
});

bot.onText(/\/cancel/, (msg) => {
    const id = msg.from.id;
    const chatId = msg.chat.id;
    let contact;
    db.find({where: {userId: id}})
        .then(user => {
            if (user.stage>0) {
                db.update({stage: 1}, {where: {userId: id}}).then(() => {
                    var options = {
                        "parse_mode": "Markdown",
                        "reply_markup": JSON.stringify({
                            "keyboard": [
                                [{ text: user.phone}]
                            ],
                            "one_time_keyboard" : true,
                            "resize_keyboard":true
                        })
                    };
                    bot.sendMessage(chatId, "Выберите номер телефона, на который вы хотите заказать такси.", options);
                })
                
            }
        })
});

bot.on('message', (msg) => {
    const id = msg.from.id; 
    const chatId = msg.chat.id;
    db.find({where: {userId: id}})
        .then(user => {
            if (user) {
                if (user.stage == 1) {
                    if (msg.text && msg.text.substring(0, 4) != '+996') {
                        return bot.sendMessage(chatId, 'Телефон должен начинаться с +996');
                    } else {
                        if (msg.contact && msg.contact.phone_number && user.phone == null) {
                            db.update({phone: '+' + msg.contact.phone_number}, {where: {userId: id}})
                        }
                        if (user.phone != msg.text && msg.text) {
                            db.update({phone: msg.text}, {where: {userId: id}})
                        }
                        
                        db.update({stage: 2}, {where: {userId: id}})
                            .then(() => {
                                let menus = [];
                                if (user.address) {
                                    let addresses = user.address.split(',');
                                    addresses.forEach(address => {
                                        let jsonData = {}
                                        jsonData['text'] = address;
                                        menus.push(jsonData);
                                    })
                                    
                                }
                                var options = {
                                    "parse_mode": "Markdown",
                                    "reply_markup": JSON.stringify({
                                        hide_keyboard: true
                                    })
                                };
                                return bot.sendMessage(chatId, "Номер "+(msg.contact ? '+'+ msg.contact.phone_number : msg.text) +" выбран. Для создания нового заказа прикрепите свое местоположение или наберите адрес вручную.", options);
                            })
                    }
                    
                } else if (user.stage == 2) {
                    let new_address;
                    let addresses;
                    if (msg.location) {
                        request('https://maps.googleapis.com/maps/api/geocode/json?latlng=' + msg.location.latitude + ',' + msg.location.longitude + '&key=AIzaSyDbcJBaK7ke05PH8jujhk1FmbpvoSH93hY&language=ru', function (error, response, body) {
                            if (!error && response.statusCode == 200) {
                                body = JSON.parse(body);
                                new_address = body.results[0].formatted_address;
                                new_address = new_address.substring(0, new_address.indexOf("Бишкек") -2);
                                if(user.address) {
                                    let old_address = user.address.split(',')
                                    if (!old_address.includes(new_address)) {
                                        if (old_address.length >4 ) {
                                            old_address.shift();
                                        }
                                        old_address.push(new_address);
                                        addresses = old_address.join(',')
                                    }
                                } else {
                                    addresses = new_address
                                }
                                db.update({address: addresses, stage:3}, {where: {userId: id}}).then(()=> {
                                    var options = { method: 'POST',
                                        url: 'https://api.taxi.namba1.co/order/request',
                                        headers: 
                                        { 'content-type': 'application/x-www-form-urlencoded' },
                                        form: {
                                            phone: user.phone, 
                                            address: new_address, 
                                            fare: 1
                                    }};
                                    request.post(options, function(err, response, body){
                                        let data = JSON.parse(body);
                                        if (data.success === true){
                                            let new_status = "New order";
                                            db.update({order_id: data.data.order_id, order_status:new_status, address: addresses, stage:3}, {where: {userId: id}}).then(()=>{
                                                let statusInterval = setInterval(()=> {
                                                    var options = { method: 'get',
                                                        url: 'https://api.taxi.namba1.co/order/status/'+data.data.order_id,
                                                        headers: 
                                                        { 'content-type': 'application/x-www-form-urlencoded' }
                                                    };
                                                    request(options, function(err, response, body){
                                                        let data = JSON.parse(body);
                                                        if (data.success === true) {
                                                            let status;
                                                            let driver; 
                                                            let trip_cost;
                                                            let options;
                                                            let avaible_statuses = ['Received', 'The taxi arrived', 'Client has been picked up', 'Completed', 'Rejected'];
                                                            switch (data.data.status) {
                                                                case 'Received': 
                                                                    status = 'Такси выехало'; 
                                                                    if (data.data.driver) driver = data.data.driver; 
                                                                    options = {
                                                                        "parse_mode": "Markdown",
                                                                        "reply_markup": JSON.stringify({
                                                                            hide_keyboard: true
                                                                        })
                                                                    };
                                                                    break;
                                                                case 'The taxi arrived': 
                                                                    status = 'Такси на месте'; 
                                                                    break;
                                                                case 'Client has been picked up': 
                                                                    status = 'В пути'; 
                                                                    break;
                                                                case 'Completed': 
                                                                    status = 'Завершен'; 
                                                                    if (data.data.trip_cost){
                                                                        trip_cost = data.data.trip_cost; 
                                                                    }       
                                                                    options = {
                                                                        "parse_mode": "Markdown",
                                                                        "reply_markup": JSON.stringify({
                                                                            "keyboard": [[{ text: 'Завершить'}]],
                                                                            "resize_keyboard":true
                                                                        })
                                                                    };
                                                                    clearInterval(statusInterval);                                 
                                                                    break;
                                                                case 'Rejected': 
                                                                    status = 'Отменен'; 
                                                                    options = {
                                                                        "parse_mode": "Markdown",
                                                                        "reply_markup": JSON.stringify({
                                                                            "keyboard": [[{ text: 'Завершить'}]],
                                                                            "resize_keyboard":true
                                                                        })
                                                                    };
                                                                    clearInterval(statusInterval); 
                                                                break;
                                                            }
                                                            let message = 'Статус: ' + status + '\n' + 
                                                            (driver ? 'Водитель:\nНомер: '+ driver.phone_number+'\nБорт: '+driver.cab_number +'\nГос. номер: '+driver.license_plate +'\nМашина: '+driver.make:'') +
                                                            (trip_cost ? '\nСтоимость поездки ' + trip_cost + ' сом':'')
                                                            db.find({where: {userId: id}}).then(user_interval => {
                                                                if (user_interval.order_id === null ) {
                                                                    return clearInterval(statusInterval);
                                                                }
                                                                if(user_interval.order_status !== data.data.status && user_interval.order_status!== null && avaible_statuses.includes(data.data.status)) {
                                                                    db.update({order_status: data.data.status}, {where: {userId: id}})
                                                                    return bot.sendMessage(chatId, message,options);
                                                                }
                                                            })
                                                        }
                                                    })
                                                },5000)
                                                var options = {
                                                    "parse_mode": "Markdown",
                                                    "reply_markup": JSON.stringify({
                                                        "keyboard": [[{ text: 'Отменить'}, {text:'Сменить номер'}]],
                                                        "resize_keyboard":true
                                                    })
                                                };
                                                bot.sendMessage(chatId, "Заказ создан. Идет поиск такси, пожалуйста, подождите. Номер заказа " + data.data.order_id, options);
                                            })
                                        }
                                        
                                    })
                                })
                            }
                            else {
                                return bot.sendMessage(chatId, "Ошибка. Введите адрес вручную")
                            }
                        });
                    } else {
                        if (msg.text == '/start') {
                            if (!user || user.phone === null) {
                                contact = { text: "Отправить контакты", request_contact: true }
                            } else {
                                contact = { text: user.phone}
                            }
                            var options = {
                                "parse_mode": "Markdown",
                                "reply_markup": JSON.stringify({
                                    "keyboard": [[contact]],
                                    "one_time_keyboard" : true,
                                    "resize_keyboard":true
                                })
                            };
                            db.update({stage: 1}, {where: {userId: id}}).then (user => {
                                return bot.sendMessage(chatId, "Здравствуйте! Это сервис Намба такси, где вы сможете заказать такси в несколько нажатий, для начала выберите номер телефона, на который вы хотите заказать такси.", options);
                            })
                        } else {
                            new_address = msg.text;
                            if(user.address) {
                                let old_address = user.address.split(',')
                                if (!old_address.includes(new_address)) {
                                    if (old_address.length >4 ) {
                                        old_address.shift();
                                    }
                                    old_address.push(new_address);
                                    addresses = old_address.join(',')
                                }
                            } else {
                                addresses = new_address
                            }
                            //db.update({address: addresses, stage:3}, {where: {userId: id}}).then(()=> {
                                var options = { method: 'POST',
                                    url: 'https://api.taxi.namba1.co/order/request',
                                    headers: 
                                    { 'content-type': 'application/x-www-form-urlencoded' },
                                    form: {
                                        phone: user.phone, 
                                        address: new_address, 
                                        fare: 1
                                }};
                                request.post(options, function(err, response, body){
                                    if (err) {
                                        return bot.sendMessage(chatId, "Произошла ошибка при создании заказа! Попробуйте позже.");
                                    }
                                    let data = JSON.parse(body);
                                    if (data.success === true){
                                        let new_status = "New order";
                                        db.update({order_id: data.data.order_id, order_status:new_status, address: addresses, stage:3}, {where: {userId: id}}).then(()=>{
                                            let statusInterval = setInterval(()=> {
                                                var options = { method: 'get',
                                                    url: 'https://api.taxi.namba1.co/order/status/' + data.data.order_id,
                                                    headers: 
                                                    { 'content-type': 'application/x-www-form-urlencoded' }
                                                };
                                                request(options, function(err, response, body){
                                                    let data = JSON.parse(body);
                                                    if (data.success === true) {
                                                        let status;
                                                        let driver; 
                                                        let trip_cost;
                                                        let options;
                                                        console.log(data.data.status)
                                                        switch (data.data.status) {
                                                            case 'Received': 
                                                                status = 'Такси выехало'; 
                                                                if (data.data.driver) driver = data.data.driver; 
                                                                options = {
                                                                    "parse_mode": "Markdown",
                                                                    "reply_markup": JSON.stringify({
                                                                        hide_keyboard: true
                                                                    })
                                                                };
                                                                break;
                                                            case 'The taxi arrived': 
                                                                status = 'Такси на месте'; 
                                                                break;
                                                            case 'Client has been picked up': 
                                                                status = 'В пути'; 
                                                                break;
                                                            case 'Completed': 
                                                                status = 'Завершен'; 
                                                                if (data.data.trip_cost){
                                                                    trip_cost = data.data.trip_cost; 
                                                                }       
                                                                options = {
                                                                    "parse_mode": "Markdown",
                                                                    "reply_markup": JSON.stringify({
                                                                        "keyboard": [[{ text: 'Завершить'}]],
                                                                        "resize_keyboard":true
                                                                    })
                                                                };
                                                                clearInterval(statusInterval);                                 
                                                                break;
                                                            case 'Rejected': 
                                                                status = 'Отменен'; 
                                                                options = {
                                                                    "parse_mode": "Markdown",
                                                                    "reply_markup": JSON.stringify({
                                                                        "keyboard": [[{ text: 'Завершить'}]],
                                                                        "resize_keyboard":true
                                                                    })
                                                                };
                                                                clearInterval(statusInterval); 
                                                            break;
                                                        }
                                                        let message = 'Статус: ' + status + '\n' + 
                                                        (driver ? 'Водитель:\nНомер: '+ driver.phone_number+'\nБорт: '+driver.cab_number +'\nГос. номер: '+driver.license_plate +'\nМашина: '+driver.make:'') +
                                                        (trip_cost ? '\nСтоимость поездки ' + trip_cost + ' сом':'')
                                                        db.find({where: {userId: id}}).then(user_interval => {
                                                            if (user_interval.order_id === null ) {
                                                                return clearInterval(statusInterval);
                                                            }
                                                            if(user_interval.order_status !== data.data.status && user_interval.order_status!== null) {
                                                                db.update({order_status: data.data.status}, {where: {userId: id}})
                                                                return bot.sendMessage(chatId, message,options);
                                                            }
                                                        })
                                                    }
                                                })
                                            },5000)
                                            var options = {
                                                "parse_mode": "Markdown",
                                                "reply_markup": JSON.stringify({
                                                    "keyboard": [[{ text: 'Отменить'}, {text:'Сменить номер'}]],
                                                    "resize_keyboard":true
                                                })
                                            };
                                            bot.sendMessage(chatId, "Заказ создан. Идет поиск такси, пожалуйста, подождите. Номер заказа " + data.data.order_id, options);
                                        })
                                    }
                                    
                                })
                            //})
                        }
                    }
                    

                    //db.update({address: msg.text}, {where: {userId: id}}).then(user => {})
                } else if (user.stage == 3){
                    if (msg.text == 'Отменить' && user.order_id !== null) {
                        var options = { method: 'get',
                            url: 'https://api.taxi.namba1.co/order/cancel/'+ user.order_id,
                            headers: 
                            { 'content-type': 'application/x-www-form-urlencoded' }
                        };
                        request(options, function(err, response, body){
                            if (err) {
                                return bot.sendMessage(chatId, "Произошла ошибка при отмене заказ! Попробуйте позже.");
                            }
                            let data = JSON.parse(body);
                            if (data.success === true) {
                                db.update({order_id: null, stage:2}, {where: {userId: id}}).then(()=> {
                                    let menus = [];
                                    if (user.address) {
                                        let addresses = user.address.split(',');
                                        addresses.forEach(address => {
                                            let jsonData = {}
                                            jsonData['text'] = address;
                                            menus.push(jsonData);
                                        })
                                        
                                    }
                                    var options = {
                                        "parse_mode": "Markdown",
                                        "reply_markup": JSON.stringify({
                                            "keyboard": [
                                                menus.slice(0,2),
                                                menus.slice(2,4),
                                                menus.slice(4,6)
                                            ],
                                            "one_time_keyboard" : true,
                                            "resize_keyboard":true
                                        })
                                    };
                                    return bot.sendMessage(chatId, "Ваш заказ успешно отменен. Отправьте адрес для создания нового заказа.", options);
                                })
                            }
                        })

                    } else if (msg.text == 'Завершить') {
                        var options = { method: 'get',
                            url: 'https://api.taxi.namba1.co/order/cancel/'+ user.order_id,
                            headers: 
                            { 'content-type': 'application/x-www-form-urlencoded' }
                        };
                        request(options, function(err, response, body){
                            db.update({order_id: null, stage:2}, {where: {userId: id}}).then(()=> {
                                let menus = [];
                                if (user.address) {
                                    let addresses = user.address.split(',');
                                    addresses.forEach(address => {
                                        let jsonData = {}
                                        jsonData['text'] = address;
                                        menus.push(jsonData);
                                    })
                                    
                                }
                                var options = {
                                    "parse_mode": "Markdown",
                                    "reply_markup": JSON.stringify({
                                        "keyboard": [
                                            menus.slice(0,2),
                                            menus.slice(2,4),
                                            menus.slice(4,6)
                                        ],
                                        "one_time_keyboard" : true,
                                        "resize_keyboard":true
                                    })
                                };
                                return bot.sendMessage(chatId, "Заказ завершен. Отправьте адрес для создания нового заказа.", options);
                            })
                        })
                            
                    } else if (msg.text == "Сменить номер") {
                        var options = { method: 'get',
                            url: 'https://api.taxi.namba1.co/order/cancel/'+ user.order_id,
                            headers: 
                            { 'content-type': 'application/x-www-form-urlencoded' }
                        };
                        request(options, function(err, response, body){
                            if (err) {
                                return bot.sendMessage(chatId, "Произошла ошибка при отмене заказ! Попробуйте позже.");
                            }
                            let data = JSON.parse(body);
                            if (data.success === true) {
                                let contact;
                                if (!user || user.phone === null) {
                                    contact = { text: "Отправить контакты", request_contact: true }
                                } else {
                                    contact = { text: user.phone}
                                }
                                var options = {
                                    "parse_mode": "Markdown",
                                    "reply_markup": JSON.stringify({
                                        "keyboard": [
                                            [contact]
                                        ],
                                        "one_time_keyboard" : true,
                                        "resize_keyboard":true
                                    })
                                };
                                db.update({order_id: null, stage:1}, {where: {userId: id}}).then(()=> {
                                    bot.sendMessage(chatId, "Введите номер, на который вы хотите заказать такси.", options);
                                })
                                
                            }
                        })
                    }
                }
            }
        })
    //console.log(msg.contact);
    //console.log('----------------------------');
    // send a message to the chat acknowledging receipt of their message
    //bot.sendMessage(chatId, 'Received your message');
});
