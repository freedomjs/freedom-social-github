/*
 * GitHub social provider
 */
var PUBLIC_GIST_DESCRIPTION = 'freedom_public';
var HEARTBEAT_GIST_DESCRIPTION = 'freedom_hearbeat';

var GithubSocialProvider = function(dispatchEvent) {
  this.dispatchEvent_ = dispatchEvent;
  this.networkName_ = 'github';
  // TODO: rename uproxyGistDescription.
  this.uproxyGistDescription_ = 'test';

  this.gists = [];
  this.userProfiles = {};
  this.userToPublicGistUrl_ = {}; // map client to uproxy gist url.
  this.myClientState_ = {};

  this.initLogger_('GithubSocialProvider');
  this.storage = freedom['core.storage']();
  this.access_token = '';
  this.users_ = {};
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
        console.log('xhr loaded');
        xhr.getResponseText().then(function(text) {
          this.access_token = text.match(/access_token=([^&]+)/)[1];
          xhr = new freedom["core.xhr"]();
          xhr.open('GET', 'https://api.github.com/user?access_token=' + this.access_token, true);
          xhr.on('onload', function() {
            xhr.getResponseText().then(function(text) {
              var user = JSON.parse(text);
              console.log(user);
              var clientState = {
                userId: user.login,
                clientId: 'myClientId',
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
  console.log('getting gists');
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var gists = JSON.parse(xhr.response);
      console.log(gists);
      for (var i = 0; i < gists.length; i++) {
        if (gists[i].description ===  description) {
          this.userToPublicGistUrl_[userId] = gists[i].url;
          return fulfill(true);
        }
      }
      return fulfill(false);
    }.bind(this);
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.createGist_ = function(description, isPublic) {
  this.checkForGist_(this.myClientState_.userId, description)
    .then(function(uproxyGistExists) {
      if (!uproxyGistExists) {
        console.log('trying to post new gist');
        var xhr = new XMLHttpRequest();
        var url = 'https://api.github.com/gists';
        xhr.open('POST', url);
        return new Promise(function(fulfill, reject) {
          // TODO: error checking
          xhr.onload = function() {
            fulfill(true);
          };
          xhr.send({
            "description": description,
            "public": isPublic,
            "files": {
              "file1.txt": {
                "content": "my key"
              }
            }
          });
        }.bind(this));
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
      for (var i = 0; i < followers.length; ++i) {
        var follower = followers[i];
        console.log(follower);
        this.checkForUproxyGist_(follower.login)
            .then(function(uproxyGistExists) {
          if (uproxyGistExists) {
            this.addUserProfile_(follower.login);
          }
        }.bind(this));
      }
    }.bind(this);
    xhr.send();
  }.bind(this));
};

/*
 * Post on given gist with given comment.
 * @param gist    url with form https://api.github.com/gists/:id/comments
 * @param comment comment to post
 */
GithubSocialProvider.prototype.postComment_ = function(gist, comment) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    xhr.open('POST', gist, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    xhr.on('onload', function() {
      xhr.getStatus().then(function(status) {
        if (status === 201) {
          fulfill();
        } else {
          reject();
        }
      }.bind(this));
    }.bind(this));
    xhr.send({string: JSON.stringify({
      "body" : comment
    })});
  }.bind(this));
};

/*
 * Get given gist.
 * @param gist    url with form https://api.github.com/gists/:id
 */
GithubSocialProvider.prototype.pullGist_ = function(gist) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    xhr.open('GET', gist + '/comments', true);
    xhr.on('onload', function() {
      xhr.getStatus().then(function(status) {
        if (status === 201) {
          xhr.getResponseText().then(function(responseText) {
            fulfill(responseText);
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
  var xhr = freedom["core.xhr"]();
  xhr.open('GET', 'https://api.github.com/users/:' + userId + '?access_token=' + this.access_token, true);
  xhr.on('onload', function() {
    xhr.getResponseText().then(function(text) {
      var user = JSON.parse(text);
      console.log(user);
      var profile = {
        userId: user.login,
        name: user.name,
        lastUpdated: Date.now(),
        url: user.url,
        imageData: user.avatar_url
      };
      this.addUserProfile_(profile);
    });
  });
};

GithubSocialProvider.prototype.finishLogin_ = function() {
  //TODO read from storage
  // construct this.users_

  this.createGist_(PUBLIC_GIST_DESCRIPTION, true);
  //this.createGist_(HEARTBEAT_GIST_DESCRIPTION, false);
  //setInterval(this.heartbeat_.bind(this), 10000); // 10 secs for now
};

GithubSocialProvider.prototype.hearbeat_ = function() {
  // TODO post a heartbeat to my private hearbeat gist
  // TODO pull my public gist and see if I have new users and raise onInvite event
  for (var user in this.users_) {
    if (typeof this.users_[user].hearbeat !== undefined) {
      this.pullGist_(this.users_[user].hearbeat).then(function(gist) {
        // TODO process and update clients
      });
    }
    if (typeof this.users_[user].signaling != undefined) {
      this.pullGist_(this.users_[user].hearbeat).then(function(gist) {
        // TODO process and raise onMessage event
      })
    }
  }
};

GithubSocialProvider.prototype.inviteFriend = function(userId) {
  this.checkForGist(userid).then(function(friendsGist) {
    this.createGist_('signaling', false).then(function(signalingGist) {
      // TODO anything else or is this ok?
      this.postComment(friendsGist, signalingGist);
      this.getUserProfile(userId); // TODO pass status
    });
  }).catch(function(e) {
    console.error('can not invite friend, not a uproxy user');
  });
};

GithubSocialProvider.prototype.acceptInvite = function(userId) {
  if (typeof this.users_[userId].signaling === undefined) {
    return Promise.reject('No invite from this user');
  };

  this.postComment(this.users_[userid].signaling, this.hearbeat);
  // TODO update user profile
  //this.users_[userId].status = ;
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
  return this.postComment_(this.userToPublicGistUrl_[toClientId] + '/comments', message);
};

/*
 * Logs out of the social network.
 */
GithubSocialProvider.prototype.logout = function() {
  return Promise.resolve();
};


/*
 * Adds a UserProfile.
 */
GithubSocialProvider.prototype.addUserProfile_ = function(profile) {
  var userProfile = {
    userId: friend.login,
    name: friend.name || friend.login || '',
    lastUpdated: Date.now(),
    url: friend.html_url || '',
    imageData: friend.avatar_url || ''
  };
  this.dispatchEvent_('onUserProfile', userProfile);
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
  if (!freedom.social) {
    freedom().providePromises(GithubSocialProvider);
  } else {
    freedom.social().providePromises(GithubSocialProvider);
  }
}
