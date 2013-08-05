var Ghost = require('../../ghost'),
    dataExport = require('../data/export'),
    dataImport = require('../data/import'),
    _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    when = require('when'),
    nodefn = require('when/node/function'),
    api = require('../api'),

    ghost = new Ghost(),
    dataProvider = ghost.dataProvider,
    adminNavbar,
    adminControllers;

 // TODO: combine path/navClass to single "slug(?)" variable with no prefix
adminNavbar = {
    dashboard: {
        name: 'Dashboard',
        navClass: 'dashboard',
        key: 'admin.navbar.dashboard',
        // defaultString: 'dashboard',
        path: '/'
    },
    content: {
        name: 'Content',
        navClass: 'content',
        key: 'admin.navbar.content',
        // defaultString: 'content',
        path: '/content/'
    },
    add: {
        name: 'New Post',
        navClass: 'editor',
        key: 'admin.navbar.editor',
        // defaultString: 'editor',
        path: '/editor/'
    },
    settings: {
        name: 'Settings',
        navClass: 'settings',
        key: 'admin.navbar.settings',
        // defaultString: 'settings',
        path: '/settings/'
    }
};

// TODO: make this a util or helper
function setSelected(list, name) {
    _.each(list, function (item, key) {
        item.selected = key === name;
    });
    return list;
}

adminControllers = {
    'login': function (req, res) {
        res.render('login', {
            bodyClass: 'ghost-login',
            hideNavbar: true,
            adminNav: setSelected(adminNavbar, 'login')
        });
    },
    'auth': function (req, res) {
        api.users.check({email: req.body.email, pw: req.body.password}).then(function (user) {
            req.session.user = "ghostadmin";
            res.json(200, {redirect: req.query.r ? '/ghost/' + req.query.r : '/ghost/'});
        }, function (error) {
            res.send(401);
        });
    },
    'signup': function (req, res) {
        res.render('signup', {
            bodyClass: 'ghost-login',
            hideNavbar: true,
            adminNav: setSelected(adminNavbar, 'login')
        });
    },
    'doRegister': function (req, res) {
        var email = req.body.email,
            password = req.body.password;

        if (email !== '' && password.length > 5) {
            api.users.add({
                email_address: email,
                password: password
            }).then(function (user) {
                res.json(200, {redirect: '/ghost/login/'});
            }, function (error) {
                res.json(401, {message: error.message});
            });
        } else {
            res.json(400, {message: 'The password is too short. Have at least 6 characters in there'});
        }
    },
    'logout': function (req, res) {
        delete req.session.user;
        req.flash('success', "You were successfully logged out");
        res.redirect('/ghost/login/');
    },
    'index': function (req, res) {
        res.render('dashboard', {
            bodyClass: 'dashboard',
            adminNav: setSelected(adminNavbar, 'dashboard')
        });
    },
    'editor': function (req, res) {
        console.log(res.locals);
        if (req.params.id !== undefined) {
            api.posts.read({id: parseInt(req.params.id, 10)})
                .then(function (post) {
                    res.render('editor', {
                        bodyClass: 'editor',
                        adminNav: setSelected(adminNavbar, 'content'),
                        title: post.get('title'),
                        content: post.get('content')
                    });
                });
        } else {
            res.render('editor', {
                bodyClass: 'editor',
                adminNav: setSelected(adminNavbar, 'add')
            });
        }
    },
    'content': function (req, res) {
        api.posts.browse({status: req.params.status || 'all'})
            .then(function (page) {
                res.render('content', {
                    bodyClass: 'manage',
                    adminNav: setSelected(adminNavbar, 'content'),
                    posts: page.posts
                });
            });
    },
    'settings': function (req, res) {
        api.settings.browse()
            .then(function (settings) {
                res.render('settings', {
                    bodyClass: 'settings',
                    adminNav: setSelected(adminNavbar, 'settings'),
                    settings: settings
                });
            });
    },
    'debug': { /* ugly temporary stuff for managing the app before it's properly finished */
        index: function (req, res) {
            res.render('debug', {
                bodyClass: 'settings',
                adminNav: setSelected(adminNavbar, 'settings')
            });
        },
        'export': function (req, res) {
            // Get current version from settings
            api.settings.read({ key: "currentVersion" })
                .then(function (setting) {
                    // Export the current versions data
                    return dataExport(setting.value);
                }, function () {
                    // If no setting, assume 001
                    return dataExport("001");
                })
                .then(function (exportedData) {
                    // Save the exported data to the file system for download
                    var fileName = path.resolve(__dirname + '/../../server/data/export/exported-' + (new Date().getTime()) + '.json');

                    return nodefn.call(fs.writeFile, fileName, JSON.stringify(exportedData)).then(function () {
                        return when(fileName);
                    });
                })
                .then(function (exportedFilePath) {
                    // Send the exported data file
                    res.download(exportedFilePath, 'GhostData.json');
                })
                .otherwise(function (error) {
                    // Notify of an error if it occurs
                    var notification = {
                        type: 'error',
                        message: error.message || error,
                        status: 'persistent',
                        id: 'per-' + (ghost.notifications.length + 1)
                    };

                    return api.notifications.add(notification).then(function () {
                        res.redirect("/ghost/debug/");
                    });
                });
        },
        'import': function (req, res) {
            if (!req.files.importfile) {
                // Notify of an error if it occurs
                var notification = {
                    type: 'error',
                    message:  "Must select a file to import",
                    status: 'persistent',
                    id: 'per-' + (ghost.notifications.length + 1)
                };

                return api.notifications.add(notification).then(function () {
                    res.redirect("/ghost/debug/");
                });
            }

            // Get the current version for importing
            api.settings.read({ key: "currentVersion" })
                .then(function (setting) {
                    return when(setting.value);
                }, function () {
                    return when("001");
                })
                .then(function (currentVersion) {
                    // Read the file contents
                    return nodefn.call(fs.readFile, req.files.importfile.path)
                        .then(function (fileContents) {
                            var importData;

                            // Parse the json data
                            try {
                                importData = JSON.parse(fileContents);
                            } catch (e) {
                                return when.reject(new Error("Failed to parse the import file"));
                            }

                            if (!importData.meta || !importData.meta.version) {
                                return when.reject(new Error("Import data does not specify version"));
                            }

                            // Import for the current version
                            return dataImport(currentVersion, importData);
                        });
                })
                .then(function importSuccess() {
                    var notification = {
                        type: 'success',
                        message: "Data imported. Log in with the user details you imported",
                        status: 'persistent',
                        id: 'per-' + (ghost.notifications.length + 1)
                    };

                    return api.notifications.add(notification).then(function () {
                        delete req.session.user;
                        res.redirect('/ghost/login/');
                    });

                }, function importFailure(error) {
                    // Notify of an error if it occurs
                    var notification = {
                        type: 'error',
                        message: error.message || error,
                        status: 'persistent',
                        id: 'per-' + (ghost.notifications.length + 1)
                    };

                    return api.notifications.add(notification).then(function () {
                        res.redirect('/ghost/debug/');
                    });
                });
        },
        'reset': function (req, res) {
            // Grab the current version so we can get the migration
            dataProvider.reset()
                .then(function resetSuccess() {
                    var notification = {
                        type: 'success',
                        message: "Database reset. Create a new user",
                        status: 'persistent',
                        id: 'per-' + (ghost.notifications.length + 1)
                    };

                    return api.notifications.add(notification).then(function () {
                        delete req.session.user;
                        res.redirect('/ghost/signup/');
                    });
                }, function resetFailure(error) {
                    var notification = {
                        type: 'error',
                        message: error.message || error,
                        status: 'persistent',
                        id: 'per-' + (ghost.notifications.length + 1)
                    };

                    return api.notifications.add(notification).then(function () {
                        res.redirect('/ghost/debug/');
                    });
                });
        }
    }
};

module.exports = adminControllers;