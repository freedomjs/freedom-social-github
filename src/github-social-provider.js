/*
 * GitHub social provider
 */
var PUBLIC_GIST_DESCRIPTION = 'freedom_public';
var HEARTBEAT_GIST_DESCRIPTION = 'freedom_hearbeat';

var MESSAGE_TYPES = {
  INVITE: 0,
  ACCEPT_INVITE: 1,
  HEARTBEAT: 2,
  MESSAGE: 3
};

var STATUS = {
  FRIEND: 0,
  INVITED_BY_USER: 1,
  USER_INVITED: 2
};

var GithubSocialProvider = function(dispatchEvent) {
  this.dispatchEvent_ = dispatchEvent;
  this.networkName_ = 'github';

  this.gists = [];
  this.userProfiles = {};
  this.myClientState_ = {};
  this.clientStates_ = {};

  this.initLogger_('GithubSocialProvider');
  this.storage = freedom['core.storage']();
  this.access_token = '';
  this.users_ = {};
  this.myHeartbeatGist_ = '';
  this.myPublicGist_ = '';
  this.lastSeenTime_ = 0; //Date.now();
};

/*
 * Initialize this.logger using the module name.
 */
GithubSocialProvider.prototype.initLogger_ = function(moduleName) {
  this.logger = console;  // Initialize to console if it exists.
  if (typeof freedom !== 'undefined' &&
      typeof freedom.core === 'function') {
    freedom.core().getLogger('[' + moduleName + ']').then(function(log) {
      this.logger = log;
    }.bind(this));
  }
};

// TODO(ldixon): We cannot use OAuth flow with the client secret for a non-web
// app (i.e. in uProxy). See https://developer.github.com/v3/oauth/#non-web-
// application-flow for the right way to do this.  If we include the client
// secret, as bellow, then the client secret is public and we open ourselves up
// to abuse and to abuse.

/*
 * Login to social network, returns a Promise that fulfills on login.
 */
GithubSocialProvider.prototype.login = function(loginOpts) {
  return new Promise(function(fulfillLogin, rejectLogin) {
    var OAUTH_REDIRECT_URLS = [
      "https://www.uproxy.org/oauth-redirect-uri",
      "http://freedomjs.org/",
      "http://localhost:8080/",
      "https://fmdppkkepalnkeommjadgbhiohihdhii.chromiumapp.org/"
    ];
    var OAUTH_CLIENT_ID = '98d31e7ceefe0518a093';
    var oauth = freedom["core.oauth"]();

    oauth.initiateOAuth(OAUTH_REDIRECT_URLS).then(function(stateObj) {
      var url ='https://github.com/login/oauth/authorize?client_id=98d31e7ceefe0518a093&scope=gist';
      return oauth.launchAuthFlow(url, stateObj).then(function(responseUrl) {
        return responseUrl.match(/code=([^&]+)/)[1];
      });
    }).then(function(code) {
      var xhr = freedom["core.xhr"]();
      xhr.open('POST', 'https://github.com/login/oauth/access_token?code=' + code +
                '&client_id=98d31e7ceefe0518a093' +
                '&client_secret=f77bf1477d4ade44d2dff674e2ff742ed540b3a1', true);
      xhr.on('onload', function() {
        xhr.getResponseText().then(function(text) {
          this.access_token = text.match(/access_token=([^&]+)/)[1];
          xhr = new freedom["core.xhr"]();
          xhr.open('GET', 'https://api.github.com/user?access_token=' + this.access_token, true);
          xhr.on('onload', function() {
            xhr.getResponseText().then(function(text) {
              var user = JSON.parse(text);
              /// XXX Do I need to fix this?
              var clientId = Math.random().toString();
              var clientState = {
                userId: user.login,
                clientId: clientId,
                status: "ONLINE",
                lastUpdated: Date.now(),
                lastSeen: Date.now()
              };

              this.myClientState_ = clientState;
              // If the user does not yet have a public uProxy gist, create one.

              fulfillLogin(clientState);
              //this.loadContacts_();

              var profile = {
                userId: user.login,
                name: user.name,
                lastUpdated: Date.now(),
                url: user.url,
                imageData: user.avatar_url
              };
              this.addUserProfile_(profile);
              this.finishLogin_();
            }.bind(this));
          }.bind(this));
          xhr.send();
        }.bind(this));
      }.bind(this));
      xhr.send();
    }.bind(this));
  }.bind(this));  // end of return new Promise
};

/*
 * Check if this user already has a public uProxy gist with their public
 * key in it.
 */
GithubSocialProvider.prototype.checkForGist_ = function(userId, description) {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + userId + '/gists';
  xhr.open('GET', url);
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.setRequestHeader("If-Modified-Since", "Sat, 2 Jan 2005 00:00:00 GMT");
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var gists = JSON.parse(xhr.response);
      for (var i = 0; i < gists.length; i++) {
        if (gists[i].description ===  description) {
          return fulfill(gists[i].id);
        }
      }
      return fulfill('');
    }.bind(this);
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.createGist_ = function(description, isPublic) {
  return this.checkForGist_(this.myClientState_.userId, description)
    .then(function(gistId) {
      if (gistId === '') {
        console.log('trying to post new gist');
        var xhr = new XMLHttpRequest();
        var url = 'https://api.github.com/gists';
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
        return new Promise(function(fulfill, reject) {
          // TODO: error checking
          xhr.onload = function() {
            //console.log(xhr.responseText);
            fulfill(JSON.parse(xhr.responseText).id);
          };
          xhr.send(JSON.stringify({
            "description": description,
            "public": isPublic,
            "files": {
              'file': {
                "content": "my key"
              }
            }
          }));
        }.bind(this));
      } else {
        return Promise.resolve(gistId);
      }
  }.bind(this));
};

/*
 * Loads contacts of the logged in user, and calls this.addUserProfile_
 * and this.updateUserProfile_ (if needed later, e.g. for async image
 * fetching) for each contact.
 */
GithubSocialProvider.prototype.loadContacts_ = function() {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + this.myClientState_.userId + '/followers';
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var followers = JSON.parse(xhr.response);
    }.bind(this);
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.postComment_ = function(gistId, messageType, comment, toClient) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    var url = 'https://api.github.com/gists/' + gistId + '/comments';
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    xhr.on('onload', function() {
      xhr.getStatus().then(function(status) {
        if (status === 201) {
          xhr.getResponseText().then(function(text) {
            var comment = JSON.parse(text);
            fulfill(comment.url);
          });
        } else {
          reject();
        }
      }.bind(this));
    }.bind(this));
    var message = {
      clientId: this.myClientState_.clientId,
      messageType: messageType,
      toClient: toClient,
      message: comment
    };
    xhr.send({string: JSON.stringify({
      "body" : JSON.stringify(message)
    })});
  }.bind(this));
};

/*
 * Get given gist.
 * @param gist    url with form https://api.github.com/gists/:id
 */
GithubSocialProvider.prototype.pullGist_ = function(gistId, from, page) {
  return new Promise(function(fulfill, reject) {
    if (typeof page === 'undefined') {
      page = 1;
    }
    var xhr = freedom["core.xhr"]();
    var url = 'https://api.github.com/gists/' + gistId + '/comments?page=' + page
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    var date = new Date(this.lastSeenTime_).toGMTString();
    xhr.setRequestHeader("If-Modified-Since", date); //"Sat, 1 Jan 2005 00:00:00 GMT");
    xhr.on('onload', function() {
      xhr.getStatus().then(function(status) {
        console.log(status);
        if (status === 200) {
          xhr.getResponseText().then(function(responseText) {
            var comments = JSON.parse(responseText);
            var new_comments = [];
            for (var i in comments) {
              if (Date.parse(comments[i].updated_at) > this.lastSeenTime_) {
                var comment = {
                  from: comments[i].user.login,
                  body: comments[i].body,
                  url: comments[i].url
                };

                if (this.isValidMessage_(comment, from)) {
                  new_comments.push(comment);
                }
              }
            }
            if (comments.length === 30) {
              this.pullGist_(gistId, from, page+1).then(function(other_comments) {
                fulfill(new_comments.concat(other_comments));
              });
            } else {
              fulfill(new_comments);
            }
          }.bind(this));
        } else {
          reject();
        }
      }.bind(this));
    }.bind(this));
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.getUserProfile_ = function(userId) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    xhr.open('GET', 'https://api.github.com/users/' + userId + '?access_token=' + this.access_token, true);
    xhr.on('onload', function() {
      xhr.getResponseText().then(function(text) {
        var user = JSON.parse(text);
        //console.log(user);
        var profile = {
          userId: user.login,
          name: user.nameGist,
          lastUpdated: Date.now(),
          url: user.url,
          imageData: user.avatar_url,
        };
        fulfill(this.addUserProfile_(profile));
      }.bind(this));
    }.bind(this));
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.restoreFromStorage_ = function() {
  this.createGist_('storage', false).then(function(gistId) {
    this.pullGist_(gistId, this.myClientState_.userId).then(function(comments) {
      switch (comments.length) {
        case 0:
          this.postComment_(gistId, -1, this.users_).then(function(url) {
            this.myStorageGist_ = url;
          }.bind(this));
          break;
        case 1:
          try {
            var body = JSON.parse(comments[0].body);
            this.users_ = body.message;
            this.myStorageGist_ = comments[0].url;
          } catch (e) {
            console.error(e);
          }
          break;
        default: console.error("no good");
      }
    }.bind(this));
  }.bind(this));
};

GithubSocialProvider.prototype.finishLogin_ = function() {
  //TODO read from storage
  // construct this.users_
  this.restoreFromStorage_();
  this.createGist_(PUBLIC_GIST_DESCRIPTION, true).then(function(gistId) {
    this.myPublicGist_ = gistId;
  }.bind(this));
  this.createGist_(HEARTBEAT_GIST_DESCRIPTION, false).then(function(gistId) {
    this.users_[this.myClientState_.userId].heartbeat = gistId;
    this.pullGist_(gistId, this.myClientState_.userId).then(function(heartbeats) {
      for (var i in heartbeats) {
        var comment = JSON.parse(heartbeats[i].body);
        if(comment.messageType === MESSAGE_TYPES.HEARTBEAT
           && comment.clientId === this.myClientState_.clientId){
          this.myHeartbeatGist_ = heartbeats[i].url;
          break;
        }
      }

      if (this.myHeartbeatGist_ === '') {
        this.postComment_(gistId,
                          MESSAGE_TYPES.HEARTBEAT,
                          {date: Date.now()}).then(function(gistUrl) {
            this.myHeartbeatGist_ = gistUrl;
        }.bind(this));
      }
    }.bind(this)).catch(function(E) {
      console.error(e);
    });
  }.bind(this));
  this.heartbeatIntervalId_ = setInterval(this.heartbeat_.bind(this), 100); // 10 secs for now
};

GithubSocialProvider.prototype.parseHeartbeat_ = function(userId, heartbeats) {
  var onlineClients = {};
  for (var i in heartbeats) {
    var comment = JSON.parse(heartbeats[i].body);
    if (comment.messageType !== MESSAGE_TYPES.HEARTBEAT) {
      console.error('not a heartbeat');
      continue;
    }
    onlineClients[comment.clientId] = true;
    this.addOrUpdateClient_(userId, comment.clientId, 'ONLINE');
  }

  for (var clientId in this.clientStates_) {
    if (this.clientStates_[clientId].userId === userId &&
        typeof onlineClients[clientId] === 'undefined'
        && clientId !== this.myClientState_.clientId) {
      this.addOrUpdateClient_(userId, clientId, 'OFFLINE');
    }
  }
};

GithubSocialProvider.prototype.isValidMessage_ = function(comment, from) {
  try {
    var message = JSON.parse(comment.body);
  } catch (e) {
    return false;
  }
  if (typeof message.messageType === 'undefined'
      || typeof message.clientId === 'undefined') {
    console.error('malformed message', message);
    // XXX return false;
    return true;;
  }

  if (typeof from !== 'undefined' && from !== comment.from) {
    // Message is not who I expect it to be from;
    // This is possible, so not an error, but still drop it.
    return false;
  }

  if (message.messageType == MESSAGE_TYPES.message) {
    // If it's a message on signaling channel
    //
    if (typeof message.toClient === 'undefined') {
      console.error('malformed message', message);
      return false;
    }

    if (message.toClient !== this.myClientState_.clientId) {
      return false;
    }
  }

  return true;
};

GithubSocialProvider.prototype.parseMessages_ = function(messages, from) {
  for (var i in messages) {
    var comment = JSON.parse(messages[i].body);

    if (comment.messageType === MESSAGE_TYPES.ACCEPT_INVITE) {
      this.users_[messages[i].from].heartbeat = comment.message.heartbeat;
      this.users_[messages[i].from].status = STATUS.FRIEND;
      this.saveToStorage_();
      /// XXX raise an event
      continue;
    }

    var clientState = {
      userId: messages[i].from,
      clientId: comment.clientId,
      status: 'ONLINE',
      lastUpdated: Date.now(),
      lastSeen: Date.now()
    };

    this.handleMessage_(clientState, comment.message);
  }
};


GithubSocialProvider.prototype.modifyComment_ = function(commentUrl, body) {
  if (typeof commentUrl === 'undefined'
      || commentUrl === '') {
    return;
  }
  var xhr = freedom["core.xhr"]();
  xhr.open('PATCH', commentUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.on('onload', function() {
    xhr.getResponseText().then(function(responseText) {
      //console.log(responseText);
    });
    xhr.getStatus().then(function(status) {
      console.log(status);
    });
  });
  xhr.send({string: JSON.stringify({
    "body": JSON.stringify(body)
  })});
};

GithubSocialProvider.prototype.saveToStorage_ = function() {
  this.modifyComment_(this.myStorageGist_, {message: this.users_});
};

GithubSocialProvider.prototype.heartbeat_ = function() {
  var currentTime = Date.now();
  /*
  this.modifyComment_(this.myHeartbeatGist_,
                      {clientId: this.myClientState_.clientId,
                       messageType: MESSAGE_TYPES.HEARTBEAT,
                       message: {
                        date: Date.now()
                      }});
*/
  var promises = [];
  if (this.myPublicGist_ !== '') {
    promises.push(this.pullGist_(this.myPublicGist_).then(function(comments) {
      for (var i in comments) {
        var comment = JSON.parse(comments[i].body);
        if (comment.messageType === MESSAGE_TYPES.INVITE) {
          this.getUserProfile_(comments[i].from).then(function(profile) {
            profile.heartbeat = comment.message.heartbeat;
            profile.signaling = comment.message.signaling;
            profile.status = STATUS.INVITED_BY_USER;
            this.saveToStorage_();
          }.bind(this));
        }
      }
    }.bind(this)));
  }
/*
  for (var user in this.users_) {
    if (typeof this.users_[user].heartbeat !== 'undefined'
        && this.users_[user].status === STATUS.FRIEND) {
      var heart = this.users_[user].heartbeat;
      promises.push(this.pullGist_(heart, user).then(this.parseHeartbeat_.bind(this, user)));
    }
    if (typeof this.users_[user].signaling != 'undefined') {
      promises.push(this.pullGist_(this.users_[user].signaling, user).then(this.parseMessages_.bind(this)));
    }
  }
*/
  Promise.all(promises).then(function() {
    this.lastSeenTime_ = currentTime;
  }.bind(this));
};

GithubSocialProvider.prototype.inviteUser = function(userId) {
  return this.checkForGist_(userId, PUBLIC_GIST_DESCRIPTION).then(function(friendGist) {
    if (friendGist === '') {
      return Promise.reject('Not a uproxy user');
    }
    return this.createGist_('signaling:' + userId, false).then(function(signalingGist) {
      return this.getUserProfile_(userId).then(function(profile) {
        profile.status = STATUS.USER_INVITED;
        profile.signaling = signalingGist;
        this.saveToStorage_();
        return this.postComment_(friendGist,
                                 MESSAGE_TYPES.INVITE,
                                 {heartbeat :this.users_[this.myClientState_.userId].heartbeat,
                                  signaling: signalingGist});
      }.bind(this));
    }.bind(this));
  }.bind(this)).catch(function(e) {
    console.error('can not invite friend, not a uproxy user');
  });
};

GithubSocialProvider.prototype.acceptUserInvitation = function(userId) {
  var signalingGist = this.users_[userId].signaling;
  if (typeof signalingGist === 'undefined') {
    return Promise.reject('No invite from this user');
  }
  this.users_[userId].status = STATUS.FRIEND;
  this.saveToStorage_();

  return this.postComment_(signalingGist,
                           MESSAGE_TYPES.ACCEPT_INVITE,
                           {heartbeat :this.users_[this.myClientState_.userId].heartbeat});
};
/*
 * Returns a Promise which fulfills with all known ClientStates.
 */
GithubSocialProvider.prototype.getClients = function() {
  return Promise.resolve({});
};

/*
 * Returns a Promise which fulfills with all known UserProfiles
 */
GithubSocialProvider.prototype.getUsers = function() {
  return Promise.resolve({});
};

/*
 * Sends a message to another clientId.
 */
GithubSocialProvider.prototype.sendMessage = function(toClientId, message) {
  /*
  if (this.clientStates_[toClientId].status !== 'ONLINE') {
    return Promise.reject('Client not online');
  }
  */

  var userId = this.clientStates_[toClientId].userId;
  var signalingGist = this.users_[userId].signaling;
  return this.postComment_(signalingGist, MESSAGE_TYPES.MESSAGE, message, toClientId);
};

/*
 * Logs out of the social network.
 */
GithubSocialProvider.prototype.logout = function() {
  clearInterval(this.heartbeatIntervalId_);
  return Promise.resolve();
};


/*
 * Adds a UserProfile.
 */
GithubSocialProvider.prototype.addUserProfile_ = function(profile) {
  var userProfile = {
    userId: profile.userId,
    name: profile.name || profile.userId || '',
    lastUpdated: Date.now(),
    url: profile.url || '',
    imageData: profile.imageData || ''
  };
  this.dispatchEvent_('onUserProfile', userProfile);
  return this.users_[profile.userId] = profile;
};

/*
 * Adds a or updates a client.  Returns the modified ClientState object.
 */
GithubSocialProvider.prototype.addOrUpdateClient_ =
    function(userId, clientId, status) {
  var clientState = {
    userId: userId,
    clientId: clientId,
    status: status,
    lastUpdated: Date.now(),
    lastSeen: Date.now()
  };

  this.clientStates_[clientId] = clientState;
  this.dispatchEvent_('onClientState', clientState);
  return clientState;
};

/*
 * Handles new messages and information about clients.
 */
GithubSocialProvider.prototype.handleMessage_ =
    function(clientState, message) {
  this.dispatchEvent_(
      'onMessage', {from: clientState, message: message});
};


// Register provider when in a module context.
if (typeof freedom !== 'undefined') {
  if (!freedom.social2) {
    freedom().providePromises(GithubSocialProvider);
  } else {
    freedom.social2().providePromises(GithubSocialProvider);
  }
}

