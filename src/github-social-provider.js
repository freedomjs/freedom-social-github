/*
 * GitHub social provider
 */

var GithubSocialProvider = function(dispatchEvent) {
  this.dispatchEvent_ = dispatchEvent;
  this.networkName_ = 'github';
  // TODO: rename uproxyGistDescription.
  this.uproxyGistDescription_ = 'test';

  this.gists = [];
  this.userProfiles = {};
  this.userToUproxyGistUrl_ = {}; // map client to uproxy gist url.

  this.initLogger_('GithubSocialProvider');
  this.initState_();
  this.storage = freedom['core.storage']();
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
    // TODO: get a real token and get real client state.
    this.getOAuthToken_(loginOpts).then(function(token) {
      if (token) {
        var clientState = {
          userId: 'myUserId',
          clientId: 'myClientId',
          status: "ONLINE",
          lastUpdated: Date.now(),
          lastSeen: Date.now()
        };

        // If the user does not yet have a public uProxy gist, create one.
        this.checkForUproxyGist_('myUserId')
            .then(function(uproxyGistExists) {
          if (!uproxyGistExists) {
            this.createUproxyGist_();
          }
        }.bind(this)).then(function() {
          fulfillLogin(clientState);
        });

        this.loadContacts_();
        // TODO: this.updateUproxySecretGists_();
      } else {
        rejectLogin("Login Failed! " + error);
        return;
      }
    }.bind(this));  // end of getOAuthToken_
  }.bind(this));  // end of return new Promise
};

/*
 * Check if this user already has a public uProxy gist with their public
 * key in it.
 */
GithubSocialProvider.prototype.checkForUproxyGist_ = function(userId) {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + userId + '/gists';
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var gists = JSON.parse(xhr.response);
      for (var i = 0; i < gists.length; i++) {
        if (gists[i].description === this.uproxyGistDescription_) {
          this.userToUproxyGistUrl_[userId] = gists[i].url;
          return fulfill(true);
        }
      }
      return fulfill(false);
    }.bind(this);
    xhr.send();
  }.bind(this));
};

/*
 * Create a public uProxy gist for this user with their public key in it.
 */
GithubSocialProvider.prototype.createUproxyGist_ = function() {
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
      "description": this.uproxyGistDescription_,
      "public": true,
      "files": {
        "file1.txt": {
          "content": "my key"
        }
      }
    });
  }.bind(this));
};

/*
 * Loads contacts of the logged in user, and calls this.addUserProfile_
 * and this.updateUserProfile_ (if needed later, e.g. for async image
 * fetching) for each contact.
 */
GithubSocialProvider.prototype.loadContacts_ = function() {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + 'myUserId' + '/followers';
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
GithubSocialProvider.prototype.sendMessage = function(friend, message) {
  return Promise.resolve();
};

/*
 * Logs out of the social network.
 */
GithubSocialProvider.prototype.logout = function() {
  return Promise.resolve();
};

/*
 * Initialize state.
 */
GithubSocialProvider.prototype.initState_ = function() {
};

/*
 * Adds a UserProfile.
 */
GithubSocialProvider.prototype.addUserProfile_ = function(friendId) {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + friendId;
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var friend = JSON.parse(xhr.response);
      var userProfile = {
        userId: friend.login,
        name: friend.name || friend.login || '',
        lastUpdated: Date.now(),
        url: friend.html_url || '',
        imageData: friend.avatar_url || ''
      };
      this.dispatchEvent_('onUserProfile', userProfile);

      var clientState = {
        userId: friend.login,
        clientId: friend.login,
        lastUpdated: Date.now(),
        lastSeen: Date.now(),
        status: "ONLINE"
      };
      this.dispatchEvent_('onClientState', clientState);

      return fulfill(userProfile);
    }.bind(this);
    xhr.send();
  }.bind(this));
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


/*
 * Returns a Promise which fulfills with an OAuth token.
 */
GithubSocialProvider.prototype.getOAuthToken_ = function() {
  return Promise.resolve('token');
};

// Register provider when in a module context.
if (typeof freedom !== 'undefined') {
  if (!freedom.social) {
    freedom().providePromises(GithubSocialProvider);
  } else {
    freedom.social().providePromises(GithubSocialProvider);
  }
}
