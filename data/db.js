var Sequelize = require("sequelize");
var sequelize = new Sequelize("telegram", "root", "12345", {
	host: '127.0.0.1',
	dialect: "mysql"
});

var user = sequelize.define("user", {
	id: {
		type: Sequelize.INTEGER,
		autoIncrement: true,
		primaryKey: true
	},
	userId: Sequelize.INTEGER,
	stage: {
		type: Sequelize.INTEGER,
	    defaultValue: 0
	},
	phone: Sequelize.STRING,
    address: Sequelize.STRING,
    order_id: Sequelize.STRING,
    order_status: Sequelize.STRING
})

//user.sync().then(function() {});



module.exports = user;