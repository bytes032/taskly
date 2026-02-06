import "reflect-metadata";

export interface RouteInfo {
	method: string;
	path: string;
	handler: string; // method name
}

const ROUTE_KEY = Symbol("route");

/**
 * Route decorator for defining HTTP routes
 */
export function Route(method: string, path: string) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		Reflect.defineMetadata(
			ROUTE_KEY,
			{ method: method.toLowerCase(), path, handler: propertyKey },
			target,
			propertyKey
		);

		const routes: RouteInfo[] = Reflect.getMetadata("routes", target.constructor) || [];
		routes.push({ method: method.toLowerCase(), path, handler: propertyKey });
		Reflect.defineMetadata("routes", routes, target.constructor);
	};
}

/**
 * HTTP method decorators
 */
export function Get(path: string) {
	return Route("GET", path);
}

export function Post(path: string) {
	return Route("POST", path);
}

export function Put(path: string) {
	return Route("PUT", path);
}

export function Delete(path: string) {
	return Route("DELETE", path);
}

/**
 * Get all routes from a controller class
 */
export function getRoutes(controllerClass: any): RouteInfo[] {
	return Reflect.getMetadata("routes", controllerClass) || [];
}
