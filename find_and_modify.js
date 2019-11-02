import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { DDP } from 'meteor/ddp';

(function () {
	// Code adapted from https://github.com/meteor/meteor/issues/1070

	// Helper func to run shared validation code
	function validate(collection, args) {
		if (!collection._name) {
			throw new Meteor.Error(405,
				'findAndModify: Must have collection name.');
		}

		if (!args) { throw new Meteor.Error(405, 'findAndModify: Must have args.'); }

		if (!args.query) { throw new Meteor.Error(405, 'findAndModify: Must have query.'); }

		if (!args.update && !args.remove) {
			throw new Meteor.Error(405,
				'findAndModify: Must have update or remove.');
		}
	}

	if (Meteor.isServer) {
		Mongo.Collection.prototype.findAndModify = function (args, rawResult) {
			validate(this, args);

			const q = {};
			q.query = args.query || {};
			q.sort = args.sort || [];
			if (args.update) { q.update = args.update; }

			q.options = {};
			if (args.new !== undefined) { q.options.new = args.new; }
			if (args.remove !== undefined) { q.options.remove = args.remove; }
			if (args.upsert !== undefined) { q.options.upsert = args.upsert; }
			if (args.fields !== undefined) { q.options.fields = args.fields; }
			if (args.writeConcern !== undefined) { q.options.w = args.writeConcern; }
			// new
			if (args.maxTimeMS !== undefined) { q.options.maxTimeMS = args.maxTimeMS; }
			if (args.wtimeout !== undefined) { q.options.wtimeout = args.wtimeout; }
			// old - maxTimeMS is not the same as wtimeout! if wtimeout is set, it must be accompanied with a writeconcern as well. See https://docs.mongodb.com/manual/reference/write-concern/ and https://docs.mongodb.com/manual/reference/method/db.collection.findAndModify/
			// if (args.maxTimeMS !== undefined)
			//	q.options.wtimeout = args.maxTimeMS;
			// trying to add explain() support...not sure if this will work :)
			if (args.explain !== undefined) { q.options.explain = 1; }
			if (args.bypassDocumentValidation !== undefined) { q.options.bypassDocumentValidation = args.bypassDocumentValidation; }

			// If upsert, assign a string Id to $setOnInsert unless otherwise provided
			if (q.options.upsert) {
				q.update = q.update || {};
				q.update.$setOnInsert = q.update.$setOnInsert || {};
				q.update.$setOnInsert._id = q.update.$setOnInsert._id || Random.id(17);
			}

			// Use rawCollection object introduced in Meteor 1.0.4.
			const collectionObj = this.rawCollection();

			const wrappedFunc = Meteor.wrapAsync(collectionObj.findAndModify,
				collectionObj);
			const result = wrappedFunc(
				q.query,
				q.sort,
				q.update,
				q.options,
			);
			return rawResult ? result : result.value;
		};
	}

	if (Meteor.isClient) {
		Mongo.Collection.prototype.findAndModify = function (args) {
			validate(this, args);

			const findOptions = {};
			if (args.sort !== undefined) { findOptions.sort = args.sort; }
			if (args.fields !== undefined) { findOptions.fields = args.fields; }
			if (args.skip !== undefined) { findOptions.skip = args.skip; }

			const ret = this.findOne(args.query, findOptions);
			if (args.remove) {
				if (ret) this.remove({ _id: ret._id });
			} else if (args.upsert && !ret) {
				const writeResult = this.upsert(args.query, args.update);
				if (writeResult.insertedId && args.new) { return this.findOne({ _id: writeResult.insertedId }, findOptions); } else if (findOptions.sort) { return {}; }
				return null;
			} else if (ret) {
				// If we're in a simulation, it's safe to call update with normal
				// selectors (which is needed, e.g., for modifiers with positional
				// operators). Otherwise, we'll have to do an _id only update to
				// get around the restriction that lets untrusted (e.g. client)
				// code update collections by _id only.
				const enclosing = DDP._CurrentInvocation.get();
				const alreadyInSimulation = enclosing && enclosing.isSimulation;
				if (alreadyInSimulation) {
					// Add _id to query because Meteor's update doesn't include certain
					// options that the full findAndModify does (like sort). Create
					// shallow copy before update so as not to mess with user's
					// original query object
					const updatedQuery = {};
					for (const prop in args.query) {
						updatedQuery[prop] = args.query[prop];
					}
					updatedQuery._id = ret._id;
					this.update(updatedQuery, args.update);
				} else {
					this.update({ _id: ret._id }, args.update);
				}

				if (args.new) { return this.findOne({ _id: ret._id }, findOptions); }
			}

			return ret;
		};
	}
}());
